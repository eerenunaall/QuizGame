/** Milliseconds since the Unix epoch, always server time inside game logic. */
export type EpochMs = number;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Integer percentage helper: `floor(value * numerator / denominator)` without float drift. */
export function mulDivFloor(value: number, numerator: number, denominator: number): number {
  return Math.floor((value * numerator) / denominator);
}
