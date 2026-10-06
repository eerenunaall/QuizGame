import { PHASES, type Phase, type ServerEvent } from '@quizparty/protocol';
import { resolveGameConfig, type GameConfig } from './config';
import { buildDeckIndex, type Deck, type DeckQuestion } from './deck';
import { createRoom, reduce } from './reducer';
import { nextWakeAt } from './timers';
import type { Actor, CommandResult, Effect, EngineCommand, EngineInput, RoomState } from './types';
import { roomView, type Viewer } from './views';

/** Deterministic test deck: `count` questions spread over the four difficulty buckets and 6 categories. */
export function makeDeck(
  count = 24,
  options: { correctIndexOf?: (i: number) => number } = {},
): Deck {
  const categories = [
    { id: 'history', label: 'Tarih' },
    { id: 'geography', label: 'Coğrafya' },
    { id: 'science', label: 'Bilim' },
    { id: 'sports', label: 'Spor' },
    { id: 'music', label: 'Müzik' },
    { id: 'cinema', label: 'Sinema' },
  ];
  const buckets = [
    'EASY',
    'EASY',
    'EASY',
    'MEDIUM',
    'MEDIUM',
    'MEDIUM',
    'HARD',
    'HARD',
    'EXPERT',
  ] as const;
  const correctIndexOf = options.correctIndexOf ?? ((i: number) => i % 4);
  const questions: DeckQuestion[] = Array.from({ length: count }, (_, i) => ({
    questionId: `q${i + 1}`,
    source: 'BANK',
    category: categories[i % categories.length]!,
    difficulty: buckets[i % buckets.length]!,
    text: `Test sorusu numara ${i + 1}: doğru seçenek hangisidir?`,
    explanation: `Açıklama ${i + 1}`,
    options: Array.from({ length: 4 }, (_, k) => ({
      key: `q${i + 1}-o${k}`,
      text: `Seçenek ${i + 1}.${k + 1}`,
      correct: k === correctIndexOf(i),
    })),
  }));
  return buildDeckIndex(questions);
}

/** Config with short phases and no special round kinds that need M2 mechanics, for fast scripted games. */
export function testConfig(override: unknown = {}): GameConfig {
  return resolveGameConfig({
    director: { maxRiskRounds: 0 },
    ...(override as object),
  });
}

export const TEST_ROOM_ID = '3f2b8c1e-5d4a-4e8b-9c1d-0a1b2c3d4e5f';

export interface HarnessOptions {
  config?: GameConfig;
  tier?: 'FREE' | 'FULL';
  now?: number;
  displayConnected?: boolean;
}

/**
 * Drives the pure engine like the server would: it stamps inputs with a controllable clock and
 * deterministic entropy, answers `needDeck` requests, and records everything for assertions.
 */
export class Harness {
  state: RoomState;
  now: number;
  readonly inputs: EngineInput[] = [];
  readonly effects: Effect[] = [];
  readonly displaySessionId = 'display-session';
  private counter = 0;
  private joined = 0;
  private games = 0;

  constructor(options: HarnessOptions = {}) {
    this.now = options.now ?? 1_700_000_000_000;
    this.state = createRoom({
      roomId: TEST_ROOM_ID,
      code: 'ABC234',
      displaySessionId: this.displaySessionId,
      now: this.now,
      config: options.config ?? testConfig(),
      tier: options.tier ?? 'FULL',
    });
    if (options.displayConnected !== false)
      this.apply({ kind: 'DISPLAY_CONNECTION', connected: true });
  }

  private messages = 0;

  private nextMessageId(): string {
    this.messages += 1;
    return `00000000-0000-4000-9000-${String(this.messages).padStart(12, '0')}`;
  }

  private nextGameId(): string {
    this.games += 1;
    return `00000000-0000-4000-8000-${String(this.games).padStart(12, '0')}`;
  }

  entropy(): string {
    this.counter += 1;
    return `entropy-${this.counter}-0123456789abcdef`;
  }

  /** Applies an input stamped with the current clock and fresh entropy. */
  apply(
    input: DistributiveOmit<EngineInput, 'at' | 'entropy'>,
    at: number = this.now,
  ): CommandResult {
    const full = { ...input, at, entropy: this.entropy() };
    const result = reduce(this.state, full);
    // The server clock is monotonic: later inputs are never stamped earlier than previous ones.
    this.now = Math.max(this.now, at);
    if (result.changed) this.inputs.push(full);
    this.state = result.state;
    this.effects.push(...result.effects);
    return result.result;
  }

  join(nickname: string): string {
    this.joined += 1;
    const playerId = `p${this.joined}`;
    const result = this.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId,
        sessionId: `s-${playerId}`,
        nickname,
        nicknameKey: nickname.toLowerCase(),
        avatarId: 'fox',
      },
    });
    if (!result.ok) throw new Error(`join failed: ${result.code}`);
    return playerId;
  }

  joinPlayers(count: number): string[] {
    return Array.from({ length: count }, (_, i) => this.join(`Player${i + 1}`));
  }

  actor(playerId: string): Actor {
    return { role: 'PLAYER', sessionId: `s-${playerId}`, playerId };
  }

  displayActor(): Actor {
    return { role: 'DISPLAY', sessionId: this.displaySessionId };
  }

  command(actor: Actor, command: EngineCommand, at: number = this.now): CommandResult {
    const messageId = this.nextMessageId();
    const nicknameKey =
      command.type === 'SET_NICKNAME' ? command.payload.nickname.toLowerCase() : undefined;
    const result = this.apply(
      { kind: 'COMMAND', actor, command, messageId, ...(nicknameKey ? { nicknameKey } : {}) },
      at,
    );
    this.fulfilDeckRequests();
    return result;
  }

  /** Answers every `needDeck` effect produced since the last call, like the server's deck builder. */
  fulfilDeckRequests(deck: Deck = makeDeck()): void {
    const pending = this.effects.filter((e) => e.kind === 'needDeck');
    this.effects.splice(
      0,
      this.effects.length,
      ...this.effects.filter((e) => e.kind !== 'needDeck'),
    );
    for (const effect of pending) {
      if (effect.kind !== 'needDeck') continue;
      this.apply({
        kind: 'BEGIN_GAME',
        requestedBy: effect.requestedBy,
        purpose: effect.purpose,
        gameId: this.nextGameId(),
        deck,
      });
    }
  }

  start(deck?: Deck): CommandResult {
    const leader = this.state.leaderPlayerId;
    const actor = leader ? this.actor(leader) : this.displayActor();
    const result = this.command(actor, { type: 'START_GAME', payload: {} });
    if (deck && result.ok) throw new Error('pass a custom deck via startWith()');
    return result;
  }

  startWith(deck: Deck): CommandResult {
    const actor = this.displayActor();
    this.apply({
      kind: 'COMMAND',
      actor,
      command: { type: 'START_GAME', payload: {} },
      messageId: this.nextMessageId(),
    });
    const pending = this.effects.filter((e) => e.kind === 'needDeck');
    this.effects.splice(
      0,
      this.effects.length,
      ...this.effects.filter((e) => e.kind !== 'needDeck'),
    );
    let result: CommandResult = { ok: false, code: 'INVALID_STATE' };
    for (const effect of pending) {
      if (effect.kind !== 'needDeck') continue;
      result = this.apply({
        kind: 'BEGIN_GAME',
        requestedBy: effect.requestedBy,
        purpose: effect.purpose,
        gameId: this.nextGameId(),
        deck,
      });
    }
    return result;
  }

  tickAt(at: number): void {
    this.now = Math.max(this.now, at);
    this.apply({ kind: 'TICK' }, at);
  }

  /** Jumps to the next scheduled wake-up and ticks; returns false when nothing is scheduled. */
  step(): boolean {
    const wake = nextWakeAt(this.state, this.now);
    if (wake === null) return false;
    this.tickAt(Math.max(wake, this.now));
    return true;
  }

  runUntil(phase: Phase, limit = 500): void {
    for (let i = 0; i < limit; i++) {
      if (this.state.phase === phase) return;
      if (!this.step()) break;
    }
    if (this.state.phase !== phase) {
      throw new Error(`did not reach ${phase}; stuck in ${this.state.phase}`);
    }
  }

  /** Advances through whole phases until the phase *after* the current one's deadline is reached. */
  runWhile(predicate: () => boolean, limit = 2000): void {
    for (let i = 0; i < limit && predicate(); i++) if (!this.step()) return;
  }

  round() {
    return this.state.game!.round!;
  }

  correctOptionId(): string {
    return this.round().question!.correctOptionId;
  }

  wrongOptionId(n = 0): string {
    return this.round().question!.options.filter((o) => !o.correct)[n]!.optionId;
  }

  answer(
    playerId: string,
    which: 'correct' | 'wrong' | (string & Record<never, never>),
    at: number = this.now,
  ): CommandResult {
    const question = this.round().question!;
    const optionId =
      which === 'correct'
        ? this.correctOptionId()
        : which === 'wrong'
          ? this.wrongOptionId()
          : which;
    return this.command(
      this.actor(playerId),
      { type: 'SUBMIT_ANSWER', payload: { questionId: question.questionId, optionId } },
      at,
    );
  }

  view(viewer: Viewer) {
    return roomView(this.state, viewer, this.now);
  }

  events(type?: ServerEvent['type']): ServerEvent[] {
    return this.effects.flatMap((e) =>
      e.kind === 'emit' && (!type || e.event.type === type) ? [e.event] : [],
    );
  }

  phaseEvents(): Phase[] {
    return this.events('PHASE_ENTERED').map(
      (e) => (e.payload as { data: { phase: Phase } }).data.phase,
    );
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export { PHASES };
