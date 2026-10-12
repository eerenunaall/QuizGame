import { runMaintenance, type MaintenanceReport } from '@quizparty/question-bank';
import type { Database } from '@quizparty/db';
import type { Clock } from '../util/clock';

/**
 * The bank is a live system (docs/QUESTION_QUALITY.md §12): on a timer, questions that expired, went
 * stale or whose answer statistics look wrong go back to REVIEW. The pass takes a database advisory
 * lock, so any number of instances can run this job and only one works at a time.
 */
export class MaintenanceJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void,
    private readonly onReport: (report: MaintenanceReport) => void = () => undefined,
  ) {}

  start(): void {
    if (this.intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  async runOnce(): Promise<MaintenanceReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const report = await runMaintenance(this.db, { now: new Date(this.clock.now()) });
      this.onReport(report);
      return report;
    } catch (error) {
      this.onError(error);
      return null;
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
