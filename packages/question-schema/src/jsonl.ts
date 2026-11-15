/**
 * JSON Lines reader with the limits an import endpoint needs: a hostile file must not be able to
 * exhaust memory or the call stack (deeply nested JSON is bounded by the line cap, which also caps
 * nesting depth in practice).
 */
export interface JsonlLimits {
  maxBytes: number;
  maxLines: number;
  maxLineChars: number;
}

export const DEFAULT_JSONL_LIMITS: JsonlLimits = {
  maxBytes: 16 * 1024 * 1024,
  maxLines: 100_000,
  maxLineChars: 32_000,
};

export interface JsonlLine {
  /** 1-based line number in the file. */
  line: number;
  value?: unknown;
  error?: 'invalid_json' | 'line_too_long';
}

export class JsonlLimitError extends Error {
  readonly reason: 'too_large' | 'too_many_lines';
  constructor(reason: 'too_large' | 'too_many_lines') {
    super(`jsonl input rejected: ${reason}`);
    this.name = 'JsonlLimitError';
    this.reason = reason;
  }
}

export function parseJsonl(input: string, limits: JsonlLimits = DEFAULT_JSONL_LIMITS): JsonlLine[] {
  if (input.length > limits.maxBytes) throw new JsonlLimitError('too_large');
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const out: JsonlLine[] = [];
  let line = 0;
  for (const raw of text.split(/\r?\n/u)) {
    line++;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (out.length >= limits.maxLines) throw new JsonlLimitError('too_many_lines');
    if (trimmed.length > limits.maxLineChars) {
      out.push({ line, error: 'line_too_long' });
      continue;
    }
    try {
      out.push({ line, value: JSON.parse(trimmed) as unknown });
    } catch {
      out.push({ line, error: 'invalid_json' });
    }
  }
  return out;
}
