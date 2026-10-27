import { describe, expect, it } from 'vitest';
import { JsonlLimitError, parseJsonl } from './jsonl';

describe('parseJsonl', () => {
  it('reads one value per line, with line numbers, skipping blanks and a BOM', () => {
    const lines = parseJsonl('\uFEFF{"a":1}\r\n\r\n{"b":2}\n');
    expect(lines).toEqual([
      { line: 1, value: { a: 1 } },
      { line: 3, value: { b: 2 } },
    ]);
  });

  it('reports a bad line without losing the others', () => {
    const lines = parseJsonl('{"a":1}\nnot json\n{"c":3}');
    expect(lines.map((line) => line.error ?? 'ok')).toEqual(['ok', 'invalid_json', 'ok']);
  });

  it('refuses hostile sizes', () => {
    expect(() =>
      parseJsonl('x'.repeat(200), { maxBytes: 100, maxLines: 10, maxLineChars: 50 }),
    ).toThrow(JsonlLimitError);
    expect(() => parseJsonl('1\n2\n3', { maxBytes: 100, maxLines: 2, maxLineChars: 50 })).toThrow(
      JsonlLimitError,
    );
    const [long] = parseJsonl(`"${'a'.repeat(100)}"`, {
      maxBytes: 1000,
      maxLines: 5,
      maxLineChars: 50,
    });
    expect(long?.error).toBe('line_too_long');
  });

  it('does not recurse into absurd nesting that fits the line cap', () => {
    const nested = '['.repeat(5_000) + ']'.repeat(5_000);
    const [line] = parseJsonl(nested);
    expect(line?.error ?? 'parsed').toMatch(/invalid_json|parsed/u);
  });
});
