import { submitReport, type ReportOutcome, type ReportReason } from '@quizparty/question-bank';
import type { Database } from '@quizparty/db';
import { PersonalReports } from '../blind/reports';
import type { FeatureFlags } from '../flags/service';
import { pseudonym } from '../security/crypto';
import type { TelemetrySink } from '../telemetry/sink';
import type { Clock } from '../util/clock';

/**
 * Player reports of a question (GDD §10). The reporter is a keyed pseudonym of the room session, so
 * one player counts once per question and a moderator never sees who. The `report.questions` flag
 * can switch the whole feature off.
 */
export class QuestionReports {
  /** Reports of personal-quiz questions go to their own queue, by id only (ADR-0015). */
  readonly personal: PersonalReports;

  constructor(
    private readonly db: Database,
    private readonly flags: FeatureFlags,
    private readonly secret: string,
    private readonly telemetry: TelemetrySink,
    clock: Clock,
  ) {
    this.personal = new PersonalReports(db, secret, clock);
  }

  enabled(): Promise<boolean> {
    return this.flags.isEnabled('report.questions');
  }

  async submit(input: {
    questionId: string;
    sessionId: string;
    roomId: string;
    reason: ReportReason;
  }): Promise<ReportOutcome> {
    const outcome = await submitReport(this.db, {
      questionId: input.questionId,
      reporterHash: pseudonym(this.secret, 'reporter', input.sessionId),
      roomId: input.roomId,
      reason: input.reason,
    });
    this.telemetry.record('question_reported', { reason: input.reason, demoted: outcome.demoted });
    return outcome;
  }
}
