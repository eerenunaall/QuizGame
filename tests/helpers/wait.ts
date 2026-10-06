/** Polls `check` until it returns a truthy value or the timeout elapses (for asynchronous persistence). */
export async function waitUntil<T>(
  check: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs = 5_000,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
