/** Injectable time source so tests and the engine never depend on the wall clock implicitly. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
