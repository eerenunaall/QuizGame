import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * This package runs in the browser (admin console) and on the server. Its tsconfig loads Node's
 * typings only so tests can use `node:fs` and `node:crypto`; this guard keeps the shipped sources
 * free of anything that exists only in Node.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(root).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
);

describe('question-schema sources', () => {
  it.each(sources)('%s uses no Node-only API', (name) => {
    const text = readFileSync(`${root}${name}`, 'utf8');
    expect(text).not.toMatch(/from 'node:|require\(|\bBuffer\b|\bprocess\.|__dirname|__filename/u);
  });
});
