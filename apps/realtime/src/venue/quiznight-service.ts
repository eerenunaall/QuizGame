import {
  ConfigSchema,
  createState,
  execute,
  hostView,
  replay,
  tvView,
  validateConfig,
  type Command,
  type HostView,
  type LogEvent,
  type QState,
  type QuizConfig,
  type TvView,
} from '@quizparty/quiznight';
import type { Database } from '@quizparty/db';
import { hmacHex, safeEqualHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import { VenueError } from './service';
import { newRewardCode, parseRewardCode } from './settings';

/** A display link lives 12 hours (ADR-0029): long enough for the night, short enough to be forgotten. */
export const LINK_TTL_MS = 12 * 3_600_000;
const REWARD_TTL_MS = 30 * 86_400_000;
const MAX_NIGHTS_PER_VENUE = 200;

export interface QuizNightDeps {
  db: Database;
  clock: Clock;
  secret: string;
  onError: (error: unknown) => void;
}

export type NightStatus = 'DRAFT' | 'READY' | 'LIVE' | 'FINISHED';
export interface NightSummary {
  id: string;
  title: string;
  date: string;
  status: NightStatus;
  rounds: number;
  questions: number;
  teams: number;
}
export interface NightDetail extends NightSummary {
  config: QuizConfig;
  issues: { issue: string; where?: string }[];
  host: HostView;
  reward: { teamName: string; text: string; issuedAt: number; redeemedAt: number | null } | null;
}

const refused = (reason: string, status = 409): VenueError =>
  new VenueError(status, 'QUIZNIGHT_REFUSED', { reason });

interface Cached {
  state: QState;
}

/**
 * Host-led quiz nights (ADR-0029). The configuration is a validated document; the night itself is an
 * append-only log replayed through the pure engine. Every call names its venue, so another café's night is
 * simply "not found". One writer per night at a time (in-process queue; the (night, seq) primary key is the
 * cross-process guard), which is why twelve simultaneous NEXT presses produce one ordered log.
 */
export class QuizNightService {
  private readonly cache = new Map<string, Cached>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: QuizNightDeps) {}

  nowMs(): number {
    return this.deps.clock.now();
  }

  private now(): number {
    return this.deps.clock.now();
  }

  /** Serialises work per night. */
  private exclusive<T>(nightId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(nightId) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.catch(() => undefined);
    this.queues.set(nightId, tail);
    void tail.then(() => {
      if (this.queues.get(nightId) === tail) this.queues.delete(nightId);
    });
    return run;
  }

  // ───────────── configuration ─────────────

  private statusFor(config: QuizConfig): NightStatus {
    return validateConfig(config).length === 0 ? 'READY' : 'DRAFT';
  }

  private summary(row: {
    id: string;
    title: string;
    event_date: string | Date;
    status: string;
    config: unknown;
  }): NightSummary {
    const config = row.config as QuizConfig;
    return {
      id: row.id,
      title: row.title,
      date: dateText(row.event_date),
      status: row.status as NightStatus,
      rounds: config.rounds.length,
      questions: config.rounds.reduce((n, r) => n + r.questions.length, 0),
      teams: config.teams.length,
    };
  }

  async list(venueId: string): Promise<NightSummary[]> {
    const rows = await this.deps.db
      .selectFrom('quiz_nights')
      .select(['id', 'title', 'event_date', 'status', 'config'])
      .where('venue_id', '=', venueId)
      .orderBy('event_date', 'desc')
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    return rows.map((r) => this.summary(r));
  }

  async create(venueId: string, accountId: string, input: unknown): Promise<NightDetail> {
    const count = await this.deps.db
      .selectFrom('quiz_nights')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('venue_id', '=', venueId)
      .executeTakeFirstOrThrow();
    if (Number(count.n) >= MAX_NIGHTS_PER_VENUE) throw refused('LIMIT_REACHED');
    const config = input;
    const parsed = ConfigSchema.safeParse(config);
    if (!parsed.success) throw new VenueError(400, 'INVALID_MESSAGE');
    const now = new Date(this.now());
    const row = await this.deps.db
      .insertInto('quiz_nights')
      .values({
        venue_id: venueId,
        title: parsed.data.title,
        event_date: parsed.data.date,
        status: this.statusFor(parsed.data),
        config: JSON.stringify(parsed.data),
        created_by: accountId,
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return this.detail(venueId, row.id);
  }

  private async row(venueId: string, nightId: string) {
    const row = await this.deps.db
      .selectFrom('quiz_nights')
      .selectAll()
      .where('id', '=', nightId)
      .where('venue_id', '=', venueId)
      .executeTakeFirst();
    if (!row) throw new VenueError(404, 'NOT_FOUND');
    return row;
  }

  async detail(venueId: string, nightId: string): Promise<NightDetail> {
    const row = await this.row(venueId, nightId);
    const config = row.config as QuizConfig;
    const state = await this.stateOf(nightId, config);
    const reward = await this.deps.db
      .selectFrom('quiz_night_rewards')
      .select(['team_name', 'reward_text', 'issued_at', 'redeemed_at'])
      .where('night_id', '=', nightId)
      .executeTakeFirst();
    return {
      ...this.summary(row),
      config,
      issues: validateConfig(config),
      host: hostView(state, this.now()),
      reward: reward
        ? {
            teamName: reward.team_name,
            text: reward.reward_text,
            issuedAt: reward.issued_at.getTime(),
            redeemedAt: reward.redeemed_at ? reward.redeemed_at.getTime() : null,
          }
        : null,
    };
  }

  /** Replace the configuration. Only before the night starts: a live night's rules never change under it. */
  async updateConfig(venueId: string, nightId: string, input: unknown): Promise<NightDetail> {
    const parsed = ConfigSchema.safeParse(input);
    if (!parsed.success) throw new VenueError(400, 'INVALID_MESSAGE');
    await this.exclusive(nightId, async () => {
      const row = await this.row(venueId, nightId);
      if (row.status === 'LIVE' || row.status === 'FINISHED') throw refused('CONFIG_LOCKED');
      await this.deps.db
        .updateTable('quiz_nights')
        .set({
          title: parsed.data.title,
          event_date: parsed.data.date,
          status: this.statusFor(parsed.data),
          config: JSON.stringify(parsed.data),
          updated_at: new Date(this.now()),
        })
        .where('id', '=', nightId)
        .where('venue_id', '=', venueId)
        .execute();
      this.cache.delete(nightId);
    });
    return this.detail(venueId, nightId);
  }

  async remove(venueId: string, nightId: string): Promise<void> {
    await this.exclusive(nightId, async () => {
      const row = await this.row(venueId, nightId);
      if (row.status === 'LIVE') throw refused('NIGHT_LIVE');
      await this.deps.db
        .deleteFrom('quiz_nights')
        .where('id', '=', nightId)
        .where('venue_id', '=', venueId)
        .execute();
      this.cache.delete(nightId);
    });
  }

  // ───────────── the night ─────────────

  private async events(nightId: string): Promise<LogEvent[]> {
    const rows = await this.deps.db
      .selectFrom('quiz_night_events')
      .select(['seq', 'at', 'actor', 'cmd', 'prev'])
      .where('night_id', '=', nightId)
      .orderBy('seq')
      .execute();
    return rows.map((r) => ({
      seq: r.seq,
      at: r.at.getTime(),
      actor: r.actor ?? 'unknown',
      cmd: r.cmd as Command,
      prev: r.prev ?? null,
    }));
  }

  private async stateOf(nightId: string, config: QuizConfig): Promise<QState> {
    const hit = this.cache.get(nightId);
    if (hit) return hit.state;
    const state = replay(config, await this.events(nightId));
    this.cache.set(nightId, { state });
    return state;
  }

  /** Append one command. `expectedSeq` makes a double tap harmless: the second press sees a newer log and is refused. */
  async command(
    venueId: string,
    nightId: string,
    accountId: string,
    cmd: Command,
    expectedSeq?: number,
  ): Promise<{ host: HostView; seq: number }> {
    return this.exclusive(nightId, async () => {
      const row = await this.row(venueId, nightId);
      const config = row.config as QuizConfig;
      if (row.status === 'DRAFT') throw refused('NOT_READY');
      const state = await this.stateOf(nightId, config);
      if (expectedSeq !== undefined && expectedSeq !== state.seq) throw refused('STALE');
      const outcome = execute(state, cmd, { now: this.now(), actor: accountId });
      if (!outcome.ok) throw refused(outcome.error);
      const { event } = outcome;
      try {
        await this.deps.db.transaction().execute(async (trx) => {
          await trx
            .insertInto('quiz_night_events')
            .values({
              night_id: nightId,
              seq: event.seq,
              at: new Date(event.at),
              actor: accountId,
              cmd: JSON.stringify(event.cmd),
              prev: event.prev === null ? null : JSON.stringify(event.prev),
            })
            .execute();
          if (cmd.type === 'START')
            await trx
              .updateTable('quiz_nights')
              .set({
                status: 'LIVE',
                started_at: new Date(event.at),
                updated_at: new Date(event.at),
              })
              .where('id', '=', nightId)
              .execute();
          if (cmd.type === 'CLOSE')
            await trx
              .updateTable('quiz_nights')
              .set({
                status: 'FINISHED',
                finished_at: new Date(event.at),
                updated_at: new Date(event.at),
              })
              .where('id', '=', nightId)
              .execute();
        });
      } catch (error) {
        // Another process won the seq: forget what we think we know and tell the tablet to refresh.
        this.cache.delete(nightId);
        if (isUniqueViolation(error)) throw refused('STALE');
        throw error;
      }
      this.cache.set(nightId, { state: outcome.state });
      return { host: hostView(outcome.state, this.now()), seq: event.seq };
    });
  }

  async hostState(venueId: string, nightId: string): Promise<HostView> {
    const row = await this.row(venueId, nightId);
    return hostView(await this.stateOf(nightId, row.config as QuizConfig), this.now());
  }

  async log(venueId: string, nightId: string): Promise<LogEvent[]> {
    await this.row(venueId, nightId);
    return this.events(nightId);
  }

  // ───────────── the TV ─────────────

  /**
   * The TV's allow-listed view of a night. The paired-display path (ADR-0028) attaches here too: it only
   * needs a night id, so it never sees more than a display link would.
   */
  async tvViewOf(nightId: string): Promise<(TvView & { venueName: string }) | null> {
    const row = await this.deps.db
      .selectFrom('quiz_nights')
      .innerJoin('venues', 'venues.id', 'quiz_nights.venue_id')
      .select(['quiz_nights.config as config', 'venues.name as venueName'])
      .where('quiz_nights.id', '=', nightId)
      .executeTakeFirst();
    if (!row) return null;
    const state = await this.stateOf(nightId, row.config as QuizConfig);
    return { ...tvView(state, this.now()), venueName: row.venueName };
  }

  private sign(linkId: string, nightId: string, expiresAt: number): string {
    return hmacHex(this.deps.secret, 'quiznight-link', `${linkId}.${nightId}.${expiresAt}`);
  }

  async createLink(
    venueId: string,
    nightId: string,
    accountId: string,
  ): Promise<{ token: string; expiresAt: number }> {
    await this.row(venueId, nightId);
    const now = this.now();
    const expiresAt = now + LINK_TTL_MS;
    const link = await this.deps.db
      .insertInto('quiz_night_links')
      .values({
        night_id: nightId,
        created_by: accountId,
        created_at: new Date(now),
        expires_at: new Date(expiresAt),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      token: `${link.id}.${expiresAt}.${this.sign(link.id, nightId, expiresAt)}`,
      expiresAt,
    };
  }

  async revokeLinks(venueId: string, nightId: string): Promise<number> {
    await this.row(venueId, nightId);
    const res = await this.deps.db
      .updateTable('quiz_night_links')
      .set({ revoked_at: new Date(this.now()) })
      .where('night_id', '=', nightId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  async activeLinkCount(venueId: string, nightId: string): Promise<number> {
    await this.row(venueId, nightId);
    const r = await this.deps.db
      .selectFrom('quiz_night_links')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('night_id', '=', nightId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date(this.now()))
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /**
   * Token → night. The night comes from the stored link row, never from the token text, so a token cannot
   * be pointed at another night; the signature binds the id, the night and the expiry.
   */
  async nightOfToken(token: string): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [linkId, expiresText, signature] = parts as [string, string, string];
    if (!/^[0-9a-f-]{36}$/.test(linkId) || !/^\d{1,15}$/.test(expiresText)) return null;
    const expiresAt = Number(expiresText);
    if (expiresAt <= this.now()) return null;
    const link = await this.deps.db
      .selectFrom('quiz_night_links')
      .select(['night_id', 'expires_at', 'revoked_at'])
      .where('id', '=', linkId)
      .executeTakeFirst();
    if (!link || link.revoked_at || link.expires_at.getTime() !== expiresAt) return null;
    if (!safeEqualHex(signature, this.sign(linkId, link.night_id, expiresAt))) return null;
    return link.night_id;
  }

  // ───────────── the prize ─────────────

  /**
   * One prize per night, only after the podium. Issuing closes the night (no more corrections), so the
   * winner the code was made for cannot change afterwards. The code is returned once and never stored.
   */
  async issueReward(
    venueId: string,
    nightId: string,
    accountId: string,
    teamId?: string,
  ): Promise<{ code: string; teamName: string; text: string; expiresAt: number }> {
    const row = await this.row(venueId, nightId);
    const config = row.config as QuizConfig;
    const state = await this.stateOf(nightId, config);
    const host = hostView(state, this.now());
    if (!host.podiumReached) throw refused('PODIUM_NOT_REACHED');
    const text = config.settings.prizeText.trim();
    if (!text) throw refused('PRIZE_NOT_SET');
    const winners = host.winnerTeamIds;
    const winner = teamId ?? (winners.length === 1 ? winners[0] : undefined);
    if (!winner) throw refused('WINNER_AMBIGUOUS');
    if (!winners.includes(winner)) throw refused('NOT_A_WINNER');
    const team = config.teams.find((t) => t.id === winner)!;
    const taken = await this.deps.db
      .selectFrom('quiz_night_rewards')
      .select('id')
      .where('night_id', '=', nightId)
      .executeTakeFirst();
    if (taken) throw refused('REWARD_ALREADY_ISSUED');
    if (!state.closed) await this.command(venueId, nightId, accountId, { type: 'CLOSE' });
    const code = newRewardCode();
    const now = this.now();
    try {
      await this.deps.db
        .insertInto('quiz_night_rewards')
        .values({
          night_id: nightId,
          venue_id: venueId,
          team_id: team.id,
          team_name: team.name,
          reward_text: text,
          code_hash: this.rewardHash(code),
          issued_at: new Date(now),
          expires_at: new Date(now + REWARD_TTL_MS),
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw refused('REWARD_ALREADY_ISSUED');
      throw error;
    }
    return { code, teamName: team.name, text, expiresAt: now + REWARD_TTL_MS };
  }

  private rewardHash(code: string): string {
    return hmacHex(this.deps.secret, 'quiznight-reward', code);
  }

  async redeem(
    venueId: string,
    staffId: string,
    input: string,
  ): Promise<{ text: string; winner: string; issuedAt: number; redeemedAt: number }> {
    const code = parseRewardCode(input);
    if (!code) throw new VenueError(404, 'NOT_FOUND');
    const hash = this.rewardHash(code);
    const now = new Date(this.now());
    const row = await this.deps.db
      .updateTable('quiz_night_rewards')
      .set({ redeemed_at: now, redeemed_by: staffId })
      .where('venue_id', '=', venueId)
      .where('code_hash', '=', hash)
      .where('redeemed_at', 'is', null)
      .where('expires_at', '>', now)
      .returning(['reward_text', 'team_name', 'issued_at'])
      .executeTakeFirst();
    if (row)
      return {
        text: row.reward_text,
        winner: row.team_name,
        issuedAt: row.issued_at.getTime(),
        redeemedAt: now.getTime(),
      };
    const known = await this.deps.db
      .selectFrom('quiz_night_rewards')
      .select(['redeemed_at'])
      .where('venue_id', '=', venueId)
      .where('code_hash', '=', hash)
      .executeTakeFirst();
    if (known?.redeemed_at)
      throw new VenueError(409, 'REWARD_ALREADY_REDEEMED', {
        redeemedAt: known.redeemed_at.getTime(),
      });
    if (known) throw new VenueError(410, 'REWARD_EXPIRED');
    throw new VenueError(404, 'NOT_FOUND');
  }

  /** A fresh empty state, exposed for the web preview of a draft. */
  static emptyState(config: QuizConfig): QState {
    return createState(config);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

function dateText(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
