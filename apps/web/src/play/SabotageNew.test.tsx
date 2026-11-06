import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseData, PhaseDataOf, RoomView } from '@quizparty/protocol';
import {
  answeringData,
  player,
  roomView,
  ROUND,
  stateWith,
  you,
} from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { createStorage } from '../lib/storage';
import { Controller } from './Controller';
import { HitNotices } from './HitNotices';
import { SabotageScreen } from './SabotageScreen';

afterEach(cleanup);

/** ADR-0023 on the phone: the three new sabotage cards, Cut's guard rails, hit notices, Blind Clock. */
const menu = (patch: Partial<PhaseDataOf<'SABOTAGE_PICK'>> = {}): PhaseDataOf<'SABOTAGE_PICK'> => ({
  phase: 'SABOTAGE_PICK',
  round: { ...ROUND, index: 3, total: 10 },
  category: { id: 'sports', label: 'Spor' },
  difficulty: 'HARD',
  committedCount: 0,
  eligibleCount: 3,
  offered: ['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX', 'STAKE_CAP', 'CUT', 'BLIND_CLOCK'],
  cutRule: { permille: 200, maxPoints: 30 },
  ...patch,
});

const powers = {
  fiftyFifty: 1,
  doubleDown: 2,
  shield: 1,
  sabotageTokens: 1,
  nextTokenAtStreak: 3,
  lockedJoker: null,
};

function mountSabotage(data = menu()) {
  const room: RoomView = roomView({
    phase: 'SABOTAGE_PICK',
    phaseData: data,
    phaseEnteredAt: 1000,
    phaseDeadlineAt: 30_000,
    players: [
      player(0, { nickname: 'Ece' }),
      player(1, { nickname: 'Ahmet' }),
      player(2, { nickname: 'Merve' }),
      player(3, { nickname: 'Can' }),
    ],
    game: {
      gameId: '22222222-2222-4222-8222-222222222222',
      totalRounds: 10,
      roundIndex: 3,
      scoreboard: [
        { playerId: 'p0', score: 400, rank: 1, streak: 2 },
        { playerId: 'p1', score: 250, rank: 2, streak: 1 },
        { playerId: 'p2', score: 100, rank: 3, streak: 0 },
        { playerId: 'p3', score: 0, rank: 4, streak: 0 },
      ],
    },
    you: you('p1', { powers, sabotage: { ready: true, decided: false } }),
  });
  const onCommit = vi.fn(() => Promise.resolve());
  render(
    <I18nProvider locale="en">
      <SabotageScreen room={room} data={data} now={() => 2000} onCommit={onCommit} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('prep-sabotage'));
  return { onCommit };
}

const card = (kind: string) => screen.getByTestId<HTMLButtonElement>(`sabotage-effect-${kind}`);

describe('the sabotage sheet with the new cards', () => {
  it('lists the whole menu, each with a name and a one-line rule', () => {
    mountSabotage();
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    expect(card('STAKE_CAP').textContent).toContain('Stake cap');
    expect(card('STAKE_CAP').textContent).toContain('highest stake next question is Risk');
    expect(card('CUT').textContent).toContain('20% of their next gain comes to you (max 30)');
    expect(card('BLIND_CLOCK').textContent).toContain('hides the countdown');
    expect(card('BLIND_CLOCK').querySelector('svg')).not.toBeNull(); // the project's own icon
  });

  it('shows only what is on the menu: a switched-off sabotage is not offered', () => {
    mountSabotage(menu({ offered: ['JAM', 'CUT'], cutRule: { permille: 100, maxPoints: 10 } }));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    expect(screen.queryByTestId('sabotage-effect-FOG')).toBeNull();
    expect(screen.queryByTestId('sabotage-effect-STAKE_CAP')).toBeNull();
    expect(card('CUT').textContent).toContain('10% of their next gain comes to you (max 10)');
  });

  it('an older server (no menu) offers the original five', () => {
    const old = menu();
    delete old.offered;
    mountSabotage(old);
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    expect(screen.queryByTestId('sabotage-effect-CUT')).toBeNull();
    expect(card('POINT_TAX')).toBeTruthy();
  });

  it('Cut is grey, with the reason, on the leader and on somebody with no points', () => {
    mountSabotage();
    fireEvent.click(screen.getByTestId('sabotage-target-Ece'));
    expect(card('CUT').disabled).toBe(true);
    expect(card('CUT').textContent).toContain('The leader cannot be cut');
    expect(card('JAM').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('sabotage-target-chosen'));
    fireEvent.click(screen.getByTestId('sabotage-target-Can'));
    expect(card('CUT').disabled).toBe(true);
    expect(card('CUT').textContent).toContain('No points to cut');
    fireEvent.click(screen.getByTestId('sabotage-target-chosen'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    expect(card('CUT').disabled).toBe(false);
  });

  it('sends the new kinds like any other', () => {
    const { onCommit } = mountSabotage();
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(card('STAKE_CAP'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    // 28 s are left, so the 2 s undo window runs first; the arming itself is visible
    expect(screen.getByTestId('sabotage-going').textContent).toContain('Stake cap → Merve');
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('hit notices', () => {
  const hits = (effect: 'STAKE_CAP' | 'CUT' | 'BLIND_CLOCK', blocked = false) =>
    you('p1', { hits: [{ effect, blocked }] });

  it.each([
    ['STAKE_CAP', 'Your highest stake next question is Risk!'],
    ['CUT', 'Part of your next gain will go to a rival.'],
    ['BLIND_CLOCK', 'Your clock is hidden. Watch the TV!'],
  ] as const)('say what %s did, without naming anybody', (effect, text) => {
    render(
      <I18nProvider locale="en">
        <HitNotices you={hits(effect)} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('hit-notices').textContent).toBe(text);
  });

  it('say the shield stopped it', () => {
    render(
      <I18nProvider locale="en">
        <HitNotices you={hits('CUT', true)} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('hit-notices').textContent).toBe('Your shield blocked: Cut');
  });
});

describe('Blind Clock on the answer screen', () => {
  function mountAnswering(blindClock: boolean) {
    const phaseData: PhaseData = answeringData({ answerDeadlineAt: 16_500 });
    const room: RoomView = roomView({
      phase: 'ANSWERING',
      phaseData,
      players: [player(0), player(1)],
      you: you('p1', {
        powers,
        effects: {
          jamMs: 0,
          order: null,
          fogOptionId: null,
          fogMs: 0,
          ...(blindClock ? { blindClock } : {}),
        },
      }),
    });
    render(
      <I18nProvider locale="en">
        <Controller
          room={room}
          state={stateWith(room)}
          now={() => 2000}
          catalog={null}
          busy={false}
          error={null}
          actions={{
            ready: vi.fn(),
            start: vi.fn(),
            settings: vi.fn(),
            answer: vi.fn(),
            rematch: vi.fn(),
            backToLobby: vi.fn(),
            leave: vi.fn(),
            kick: vi.fn(),
            makeLeader: vi.fn(),
            commitRisk: vi.fn(() => Promise.resolve()),
            commitSabotage: vi.fn(() => Promise.resolve()),
            fifty: vi.fn(),
            setReduced: vi.fn(),
            submitStatement: vi.fn(() => Promise.resolve()),
          }}
          storage={createStorage(null)}
        />
      </I18nProvider>,
    );
  }

  it('replaces the countdown with a note, and leaves the answers alone', () => {
    mountAnswering(true);
    expect(screen.getByTestId('blind-clock').textContent).toBe('Clock hidden - watch the TV');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
  });

  it('does nothing when the clock is not blinded', () => {
    mountAnswering(false);
    expect(screen.queryByTestId('blind-clock')).toBeNull();
  });
});
