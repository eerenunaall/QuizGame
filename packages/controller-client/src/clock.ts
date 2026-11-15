/**
 * NTP-style clock offset estimation (ADR-0006). The sample with the smallest round trip is the
 * most trustworthy, so countdowns are rendered from `serverNow()` — a monotonic clock anchored to
 * server time — and a wrong device clock only affects cosmetics, never validity.
 */
interface Sample {
  rtt: number;
  serverAtRecv: number;
  recvPerf: number;
  recvWall: number;
}

/**
 * A phone that is locked or a tab that is frozen stops the OS monotonic clock behind
 * `performance.now()` (Android, iOS) while the wall clock keeps running. When the two disagree by
 * more than this, the device slept: the sample's anchor is behind by the sleep and must not win.
 */
const SLEEP_GAP_MS = 1_000;

export class ClockSync {
  private samples: Sample[] = [];
  private best: Sample | null = null;
  private readonly perf: () => number;
  private readonly wall: () => number;

  constructor(perf: () => number, wall: () => number) {
    this.perf = perf;
    this.wall = wall;
  }

  observe(sentPerf: number, recvPerf: number, serverTime: number): void {
    const rtt = recvPerf - sentPerf;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10_000) return;
    // Samples taken before a sleep are anchored to a monotonic clock that lost time: forget them,
    // or their smaller round trip would keep the countdown behind the server for another minute.
    this.samples = this.samples.filter((sample) => this.sleptSince(sample) === 0);
    this.samples.push({
      rtt,
      serverAtRecv: serverTime + rtt / 2,
      recvPerf,
      recvWall: this.wall(),
    });
    if (this.samples.length > 8) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rtt <= a.rtt ? b : a));
  }

  /** Milliseconds of wall time the monotonic clock missed since `sample` (0 when it kept up). */
  private sleptSince(sample: Sample): number {
    const gap = this.wall() - sample.recvWall - (this.perf() - sample.recvPerf);
    return gap > SLEEP_GAP_MS ? gap : 0;
  }

  /** Estimated current server time in epoch ms. */
  serverNow(): number {
    if (!this.best) return this.wall();
    return this.best.serverAtRecv + (this.perf() - this.best.recvPerf) + this.sleptSince(this.best);
  }

  rtt(): number | null {
    return this.best?.rtt ?? null;
  }

  hasSample(): boolean {
    return this.best !== null;
  }
}
