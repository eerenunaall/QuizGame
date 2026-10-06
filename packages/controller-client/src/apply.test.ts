import { describe, expect, it } from 'vitest';
import { applyServerMessage } from './apply';
import { answeringData, message, player, ROUND, roomView, stateWith, you } from './fixtures';

const NOW = 5_000;

describe('applyServerMessage', () => {
  it('snapshots replace the room and mark restoration only for RECONNECTED', () => {
    const fresh = roomView({
      stateVersion: 9,
      phase: 'COUNTDOWN',
      phaseData: { phase: 'COUNTDOWN' },
    });
    const session = { sessionId: 's', playerId: 'p1', reconnectToken: 'x'.repeat(43) };

    const joined = applyServerMessage(
      stateWith(null),
      message('ROOM_JOINED', { session, room: fresh }),
      NOW,
    );
    expect(joined.room?.stateVersion).toBe(9);
    expect(joined.restoredAt).toBeNull();

    const reconnected = applyServerMessage(
      stateWith(roomView()),
      message('RECONNECTED', { session, role: 'PLAYER', room: fresh }),
      NOW,
    );
    expect(reconnected.restoredAt).toBe(NOW);
    expect(reconnected.pendingAnswer).toBeNull();
  });

  it('PHASE_ENTERED updates phase data, deadlines and the game summary', () => {
    const state = stateWith(roomView());
    const next = applyServerMessage(
      state,
      message(
        'PHASE_ENTERED',
        {
          phaseEnteredAt: 3_000,
          phaseDeadlineAt: 4_000,
          data: { phase: 'ROUND_INTRO', round: ROUND },
        },
        { stateVersion: 2 },
      ),
      NOW,
    );
    expect(next.room?.phase).toBe('ROUND_INTRO');
    expect(next.room?.phaseDeadlineAt).toBe(4_000);
    expect(next.room?.stateVersion).toBe(2);
    expect(next.room?.game?.totalRounds).toBe(5);
  });

  it('ignores a PHASE_ENTERED older than the current state version', () => {
    const state = stateWith(roomView({ stateVersion: 10 }));
    const next = applyServerMessage(
      state,
      message(
        'PHASE_ENTERED',
        { phaseEnteredAt: 3_000, phaseDeadlineAt: null, data: { phase: 'COUNTDOWN' } },
        { stateVersion: 4 },
      ),
      NOW,
    );
    expect(next).toBe(state);
  });

  it('clears ready flags when the lobby restarts', () => {
    const state = stateWith(
      roomView({ players: [player(0, { ready: true }), player(1, { ready: true })] }),
    );
    const next = applyServerMessage(
      state,
      message(
        'PHASE_ENTERED',
        { phaseEnteredAt: 3_000, phaseDeadlineAt: null, data: { phase: 'LOBBY' } },
        { stateVersion: 2 },
      ),
      NOW,
    );
    expect(next.room?.players.every((p) => !p.ready)).toBe(true);
  });

  it('resets the local answer state when a new question opens', () => {
    const state = stateWith(roomView(), {
      pendingAnswer: { questionId: 'old', optionId: 'optionAAAA' },
    });
    const next = applyServerMessage(
      state,
      message(
        'PHASE_ENTERED',
        { phaseEnteredAt: 3_000, phaseDeadlineAt: 18_000, data: answeringData() },
        { stateVersion: 2 },
      ),
      NOW,
    );
    expect(next.pendingAnswer).toBeNull();
    expect(next.room?.you?.answer).toBeNull();
  });

  it('tracks answered players without duplicates and only while answering', () => {
    const answering = stateWith(roomView({ phase: 'ANSWERING', phaseData: answeringData() }));
    const once = applyServerMessage(
      answering,
      message('ANSWER_LOCKED', { playerId: 'p0', answeredCount: 1, eligibleCount: 2 }),
      NOW,
    );
    const twice = applyServerMessage(
      once,
      message('ANSWER_LOCKED', { playerId: 'p0', answeredCount: 1, eligibleCount: 2 }),
      NOW,
    );
    expect(twice.room?.phaseData).toMatchObject({ answeredPlayerIds: ['p0'] });

    const lobby = stateWith(roomView());
    expect(
      applyServerMessage(
        lobby,
        message('ANSWER_LOCKED', { playerId: 'p0', answeredCount: 1, eligibleCount: 2 }),
        NOW,
      ).room,
    ).toBe(lobby.room);
  });

  it('follows QUESTION_PREP progress and ignores it in any other phase', () => {
    const prep = stateWith(
      roomView({
        phase: 'QUESTION_PREP',
        phaseData: {
          phase: 'QUESTION_PREP',
          round: ROUND,
          category: { id: 'geography', label: 'Coğrafya' },
          difficulty: 'EASY',
          riskLadder: [{ tier: 'SAFE', multiplier: 1, loss: 0 }],
          stakeMandatory: false,
          doubleDownEnabled: true,
          sabotageEnabled: false,
          committedCount: 0,
          eligibleCount: 3,
        },
      }),
    );
    const next = applyServerMessage(
      prep,
      message('PREP_PROGRESS', { committedCount: 2, eligibleCount: 3 }),
      NOW,
    );
    expect(next.room?.phaseData).toMatchObject({ committedCount: 2, eligibleCount: 3 });
    expect(prep.room?.phaseData).toMatchObject({ committedCount: 0 }); // immutable update

    const answering = stateWith(roomView({ phase: 'ANSWERING', phaseData: answeringData() }));
    expect(
      applyServerMessage(
        answering,
        message('PREP_PROGRESS', { committedCount: 1, eligibleCount: 3 }),
        NOW,
      ).room,
    ).toBe(answering.room);
  });

  it('replaces the private view wholesale on PLAYER_STATE (powers, commitment, effects)', () => {
    const state = stateWith(roomView());
    const mine = you('p1', {
      powers: {
        fiftyFifty: 1,
        doubleDown: 2,
        shield: 1,
        sabotageTokens: 1,
        nextTokenAtStreak: 3,
        lockedJoker: null,
      },
      commitment: { stake: 'RISK', doubleDown: true, sabotage: null },
      hits: [{ effect: 'JAM', blocked: false }],
    });
    const next = applyServerMessage(state, message('PLAYER_STATE', { you: mine }), NOW);
    expect(next.room?.you).toEqual(mine);
  });

  it('records an accepted answer on `you` and a rejection as a client error', () => {
    const state = stateWith(roomView({ phase: 'ANSWERING', phaseData: answeringData() }), {
      pendingAnswer: { questionId: 'q1', optionId: 'optionAAAA' },
    });
    const accepted = applyServerMessage(
      state,
      message('ANSWER_ACCEPTED', {
        messageId: '22222222-2222-4222-8222-222222222222',
        questionId: 'q1',
        optionId: 'optionAAAA',
        lockedAt: 3_333,
      }),
      NOW,
    );
    expect(accepted.pendingAnswer).toBeNull();
    expect(accepted.room?.you?.answer).toEqual({
      questionId: 'q1',
      optionId: 'optionAAAA',
      lockedAt: 3_333,
    });

    const rejected = applyServerMessage(
      state,
      message('ANSWER_REJECTED', {
        messageId: '22222222-2222-4222-8222-222222222222',
        code: 'ANSWER_TOO_LATE',
      }),
      NOW,
    );
    expect(rejected.pendingAnswer).toBeNull();
    expect(rejected.answerRejection).toEqual({ code: 'ANSWER_TOO_LATE', at: NOW });
  });

  it('keeps players ordered by join index and applies roster events', () => {
    let state = stateWith(roomView({ players: [player(0), player(2)] }));
    state = applyServerMessage(state, message('PLAYER_JOINED', { player: player(1) }), NOW);
    expect(state.room?.players.map((p) => p.joinIndex)).toEqual([0, 1, 2]);

    state = applyServerMessage(
      state,
      message('PLAYER_STATUS', { playerId: 'p1', connection: 'DISCONNECTED', ready: false }),
      NOW,
    );
    expect(state.room?.players.find((p) => p.playerId === 'p1')?.connection).toBe('DISCONNECTED');

    state = applyServerMessage(state, message('LEADER_CHANGED', { playerId: 'p1' }), NOW);
    expect(state.room?.players.filter((p) => p.isLeader).map((p) => p.playerId)).toEqual(['p1']);
    expect(state.room?.you).toMatchObject({ isLeader: true, canHost: true });

    state = applyServerMessage(
      state,
      message('NICKNAME_CHANGED', { playerId: 'p1', nickname: 'Yeni' }),
      NOW,
    );
    expect(state.room?.players.find((p) => p.playerId === 'p1')?.nickname).toBe('Yeni');

    state = applyServerMessage(
      state,
      message('PLAYER_LEFT', { playerId: 'p2', reason: 'LEFT' }),
      NOW,
    );
    expect(state.room?.players.map((p) => p.playerId)).toEqual(['p0', 'p1']);
  });

  it('applies settings, tier and display status changes', () => {
    let state = stateWith(roomView());
    state = applyServerMessage(
      state,
      message('SETTINGS_CHANGED', {
        settings: { mode: 'CLASSIC', rounds: 8, difficulty: 'HARD', categories: 'ALL' },
      }),
      NOW,
    );
    expect(state.room?.settings.rounds).toBe(8);
    state = applyServerMessage(
      state,
      message('ENTITLEMENT_CHANGED', { tier: 'FULL', reason: 'GRANTED' }),
      NOW,
    );
    expect(state.room?.tier).toBe('FULL');
    state = applyServerMessage(
      state,
      message('DISPLAY_STATUS', { connected: false, awaitingDisplay: true }),
      NOW,
    );
    expect(state.room).toMatchObject({ displayConnected: false, awaitingDisplay: true });
  });

  it('ignores room-scoped events when there is no room yet', () => {
    const state = stateWith(null);
    expect(
      applyServerMessage(state, message('PLAYER_LEFT', { playerId: 'p1', reason: 'LEFT' }), NOW),
    ).toEqual(state);
  });

  it('turns revocation and supersession into closed transports', () => {
    const revoked = applyServerMessage(
      stateWith(roomView()),
      message('SESSION_REVOKED', { reason: 'KICKED' }),
      NOW,
    );
    expect(revoked).toMatchObject({ transport: 'CLOSED', closedReason: 'KICKED' });
    const superseded = applyServerMessage(
      stateWith(roomView()),
      message('SESSION_SUPERSEDED', {}),
      NOW,
    );
    expect(superseded).toMatchObject({ transport: 'CLOSED', closedReason: 'SUPERSEDED' });
  });

  it('surfaces protocol errors with parameters', () => {
    const state = applyServerMessage(
      stateWith(roomView()),
      message('ERROR', { messageId: null, code: 'RATE_LIMITED', params: { retryAfterMs: 1500 } }),
      NOW,
    );
    expect(state.error).toEqual({ code: 'RATE_LIMITED', at: NOW, params: { retryAfterMs: 1500 } });
  });
});
