import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopedName } from '../../css-scope';

// Vitest runs from the repository root (package.json scripts); jsdom's URL is not Node's, so no URL maths here.
const SRC = join(process.cwd(), 'apps/web/src');

function files(directory: string, suffix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

describe('CSS module names', () => {
  it('scopes classes per file but leaves the shared qp-* motion vocabulary alone', () => {
    expect(scopedName('qp-pop-in', '/a/Card.module.css')).toBe('qp-pop-in');
    expect(scopedName('card', '/a/Card.module.css')).toMatch(/^_card_[\w-]{5}$/u);
    expect(scopedName('card', '/a/Card.module.css')).toBe(scopedName('card', '/a/Card.module.css'));
    expect(scopedName('card', '/a/Card.module.css')).not.toBe(
      scopedName('card', '/b/Other.module.css'),
    );
    expect(scopedName('card', '/a/Card.module.css')).not.toBe(
      scopedName('title', '/a/Card.module.css'),
    );
  });

  // Regression: every `animation: qp-... ` in a module was renamed to a hashed name that matched no
  // @keyframes, so none of the shared animations ever ran. Each qp-* name used by a module must be
  // defined as keyframes in the global sheets (or in the module itself).
  it('only references qp-* keyframes that exist', () => {
    const globalCss = [join(SRC, 'styles/global.css'), join(SRC, 'styles/motion.css')]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const defined = (css: string): Set<string> =>
      new Set([...css.matchAll(/@keyframes\s+([\w-]+)/gu)].map((match) => match[1]!));
    const shared = defined(globalCss);
    expect(shared.size).toBeGreaterThan(30);

    const missing: string[] = [];
    for (const file of files(SRC, '.module.css')) {
      const css = readFileSync(file, 'utf8');
      const local = defined(css);
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, '');
      for (const declaration of withoutComments.matchAll(/animation(?:-name)?\s*:([^;}]*)/gu)) {
        for (const name of declaration[1]!.matchAll(/(?<![\w-])(qp-[\w-]+)/gu)) {
          if (!shared.has(name[1]!) && !local.has(name[1]!))
            missing.push(`${file.slice(SRC.length)}: ${name[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
