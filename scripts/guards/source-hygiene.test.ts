import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source files must not hide behaviour behind invisible or direction-changing characters
 * ("Trojan Source", CVE-2021-42574) and must stay valid UTF-8 without a BOM.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', 'coverage', '.expo']);
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.html',
  '.sql',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
]);
// Bidi controls (LRE…RLO, LRI…PDI), zero-width characters, word joiner and the BOM — written as
// code point ranges so this file itself contains none of them.
const SUSPICIOUS_RANGES: readonly (readonly [number, number])[] = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x200b, 0x200f],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];

function findSuspicious(text: string): { index: number; codePoint: number } | null {
  for (let index = 0; index < text.length; index++) {
    const codePoint = text.charCodeAt(index);
    if (SUSPICIOUS_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high))
      return { index, codePoint };
  }
  return null;
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(directory, entry);
    const info = statSync(path);
    if (info.isDirectory()) yield* walk(path);
    else yield path;
  }
}

describe('source hygiene', () => {
  const files = [...walk(ROOT)].filter((path) => {
    const dot = path.lastIndexOf('.');
    return dot > 0 && TEXT_EXTENSIONS.has(path.slice(dot)) && !path.endsWith('pnpm-lock.yaml');
  });

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('contains no bidi controls, zero-width characters or BOMs (use escapes in tests instead)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const hit = findSuspicious(text);
      if (hit) {
        const line = text.slice(0, hit.index).split('\n').length;
        offenders.push(
          `${relative(ROOT, file)}:${line} U+${hit.codePoint.toString(16).toUpperCase()}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
