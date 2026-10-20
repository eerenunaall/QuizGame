/**
 * NTP-style clock offset estimation (ADR-0006). The sample with the smallest round trip is the
 * most trustworthy, so countdowns are rendered from `serverNow()` — a monotonic clock anchored to
 * server time — and a wrong device clock only affects cosmetics, never validity.
 */
export class ClockSync {
  private samples: { rtt: number; serverAtRecv: number; recvPerf: number }[] = [];
  private best: { rtt: number; serverAtRecv: number; recvPerf: number } | null = null;
  private readonly perf: () => number;
  private readonly wall: () => number;

  constructor(perf: () => number, wall: () => number) {
    this.perf = perf;
    this.wall = wall;
  }

  observe(sentPerf: number, recvPerf: number, serverTime: number): void {
    const rtt = recvPerf - sentPerf;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10_000) return;
    this.samples.push({ rtt, serverAtRecv: serverTime + rtt / 2, recvPerf });
    if (this.samples.length > 8) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rtt <= a.rtt ? b : a));
  }

  /** Estimated current server time in epoch ms. */
  serverNow(): number {
    if (!this.best) return this.wall();
    return this.best.serverAtRecv + (this.perf() - this.best.recvPerf);
  }

  rtt(): number | null {
    return this.best?.rtt ?? null;
  }

  hasSample(): boolean {
    return this.best !== null;
  }
}
