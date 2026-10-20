/** Throws when an internal invariant is violated. Never use for validating external input. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant violated: ${message}`);
}

/** Exhaustiveness helper: a compile error if a union case is not handled. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
