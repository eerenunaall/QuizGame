import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0015's structural rule: personal answers are opened in one module. This test pins who may
 * import it and who may touch the sealed column, so adding a route that returns a raw answer to the
 * creator (or anyone else) cannot happen by accident: it has to change this list in review.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}
const sources = files(SRC).map((path) => ({
  path: relative(SRC, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));
const importing = (needle: RegExp) =>
  sources
    .filter((s) => needle.test(s.text))
    .map((s) => s.path)
    .sort();

describe('who may reach a personal answer', () => {
  it('only these modules import the vault', () => {
    expect(importing(/from '(?:\.\.?\/)+(?:blind\/)?vault'/u)).toEqual([
      'app.ts',
      'blind/decks.ts',
      'blind/quizzes.ts',
      'blind/routes.ts',
    ]);
  });

  it('only the vault and the app wiring import the sealer', () => {
    expect(importing(/from '(?:\.\.?\/)+(?:blind\/)?sealer'/u)).toEqual([
      'app.ts',
      'blind/vault.ts',
    ]);
  });

  it('only the vault ever reads the sealed column', () => {
    expect(importing(/blind_responses\.sealed|'sealed'|\.sealed\b/u)).toEqual(['blind/vault.ts']);
  });

  it('the creator-side service never selects a response row at all', () => {
    const quizzes = sources
      .find((s) => s.path === 'blind/quizzes.ts')!
      .text.replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '');
    expect(quizzes).not.toMatch(/selectFrom\('blind_responses'\)\s*\.(?:select\(\[|selectAll)/u);
    expect(quizzes).not.toMatch(/sealed|open\(|decrypt/u);
  });
});
