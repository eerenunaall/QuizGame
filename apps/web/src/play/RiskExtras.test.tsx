import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf, RoomView, YouView } from '@quizparty/protocol';
import { player, roomView, ROUND, you } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { RiskScreen } from './RiskScreen';
import type { RiskChoice } from './powers';

afterEach(cleanup);

/** ADR-0023 on the RISK_PICK phone: Cover, Pot, Duel cards, the invite panel and the Stake Cap. */
const prep = (patch: Partial<PhaseDataOf<'RISK_PICK'>> = {}): PhaseDataOf<'RISK_PICK'> => ({
  phase: 'RISK_PICK',
  round: { ...ROUND, index: 3, total: 10 },
  category: { id: 'sports', label: 'Spor' },
  difficulty: 'HARD',
  riskLadder: [
    { tier: 'SAFE', multiplier: 1, loss: 0, coverFee: 0 },
    { tier: 'RISK', multiplier: 2, loss: 100, coverFee: 50 },
    { tier: 'HIGH', multiplier: 3, loss: 200, coverFee: 100 },
  ],
  stakeMandatory: false,
  doubleDownEnabled: true,
  doubleDownExcludedStakes: ['HIGH', 'ALL_IN'],
  sabotageEnabled: true,
  risks: {
    cover: true,
    duel: { win: 80, bothRight: 40 },
    pot: { ante: 30, minPlayers: 3 },
  },
  committedCount: 1,
  eligibleCount: 3,
  ...patch,
});

const powers = (patch: Record<string, unknown> = {}) => ({
  fiftyFifty: 1,
  doubleDown: 2,
  shield: 1,
  sabotageTokens: 1,
  nextTokenAtStreak: 3,
  lockedJoker: null,
  cover: 1,
  duel: 2,
  pot: 2,
  ...patch,
});

function mount(
  options: {
    data?: PhaseDataOf<'RISK_PICK'>;
    me?: YouView;
    onCommit?: (choice: RiskChoice) => Promise<void>;
    onRespond?: (challengerId: string, accept: boolean) => Promise<void>;
    score?: number;
    offline?: string[];
  } = {},
) {
  const data = options.data ?? prep();
  const room: RoomView = roomView({
    phase: 'RISK_PICK',
    phaseData: data,
    phaseEnteredAt: 1000,
    phaseDeadlineAt: 9000,
    players: [
      player(0, { nickname: 'Ece' }),
      player(1, { nickname: 'Ahmet' }),
      player(2, { nickname: 'Merve' }),
    ].map((p) =>
      options.offline?.includes(p.playerId) ? { ...p, connection: 'DISCONNECTED' } : p,
    ),
    game: {
      gameId: '22222222-2222-4222-8222-222222222222',
      totalRounds: 10,
      roundIndex: 3,
      scoreboard: [
        { playerId: 'p0', score: 400, rank: 1, streak: 2 },
        { playerId: 'p1', score: options.score ?? 250, rank: 2, streak: 1 },
        { playerId: 'p2', score: 100, rank: 3, streak: 0 },
      ],
    },
    you: options.me ?? you('p1', { powers: powers() }),
  });
  const onCommit = options.onCommit ?? vi.fn(() => Promise.resolve());
  const onRespond = options.onRespond ?? vi.fn(() => Promise.resolve());
  render(
    <I18nProvider locale="en">
      <RiskScreen
        room={room}
        data={data}
        now={() => 2000}
        onCommit={onCommit}
        onRespond={onRespond}
      />
    </I18nProvider>,
  );
  return { onCommit, onRespond };
}

const button = (id: string) => screen.getByTestId<HTMLButtonElement>(id);

describe('Cover, Pot and Duel cards', () => {
  it('show the name, a one-line rule with the numbers and what is left', () => {
    mount();
    expect(button('risk-cover').textContent).toContain('Cover');
    expect(button('risk-pot').textContent).toContain('Join the pot: 30 in');
    expect(button('risk-duel').textContent).toContain('you take 80');
    expect(button('risk-pot').textContent).toContain('2 left');
  });

  it('send Cover, Pot and a Duel challenge with the stake in one message', async () => {
    const { onCommit } = mount();
    fireEvent.click(screen.getByTestId('stake-RISK'));
    expect(button('risk-cover').textContent).toContain('−50 now');
    fireEvent.click(button('risk-cover'));
    fireEvent.click(button('risk-pot'));
    fireEvent.click(button('risk-duel'));
    fireEvent.click(screen.getByTestId('duel-rival-Merve'));
    expect(button('risk-duel').textContent).toContain('Rival: Merve');
    fireEvent.click(screen.getByTestId('prep-ready'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'RISK',
      doubleDown: false,
      cover: true,
      pot: true,
      duel: { targetId: 'p2' },
    });
  });

  it('say why they are grey, in one line', () => {
    mount({ me: you('p1', { powers: powers({ cover: 0, pot: 0, duel: 0 }) }) });
    for (const id of ['risk-cover', 'risk-pot', 'risk-duel']) {
      expect(button(id).disabled).toBe(true);
      expect(button(id).textContent).toContain('None left');
    }
  });

  it('Cover needs a stake with something to lose, and not Double Down', () => {
    mount();
    expect(button('risk-cover').disabled).toBe(true);
    expect(button('risk-cover').textContent).toContain('Needs Risk or higher');
    fireEvent.click(screen.getByTestId('stake-RISK'));
    expect(button('risk-cover').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('prep-double-down'));
    expect(button('risk-cover').disabled).toBe(true);
    expect(button('risk-cover').textContent).toContain('One big gamble per question');
  });

  it('Pot needs the ante in hand and enough players', () => {
    mount({ score: 20 });
    expect(button('risk-pot').disabled).toBe(true);
    expect(button('risk-pot').textContent).toContain('Needs at least 30 points');
    cleanup();
    mount({ data: prep({ risks: { cover: true, duel: null, pot: { ante: 30, minPlayers: 4 } } }) });
    expect(button('risk-pot').textContent).toContain('Needs more players');
  });

  it('one big gamble: a Duel and HIGH or Double Down exclude each other, both ways', () => {
    mount();
    fireEvent.click(screen.getByTestId('stake-HIGH'));
    expect(button('risk-duel').disabled).toBe(true);
    expect(button('risk-duel').textContent).toContain('One big gamble per question');
    fireEvent.click(screen.getByTestId('stake-RISK'));
    fireEvent.click(button('risk-duel'));
    fireEvent.click(screen.getByTestId('duel-rival-Merve'));
    expect(screen.getByTestId<HTMLButtonElement>('stake-HIGH').disabled).toBe(true);
    expect(button('prep-double-down').disabled).toBe(true);
    expect(button('prep-double-down').textContent).toContain('One big gamble per question');
  });

  it('a Duel needs somebody online to challenge', () => {
    mount({ offline: ['p0', 'p2'] });
    expect(button('risk-duel').disabled).toBe(true);
    expect(button('risk-duel').textContent).toContain('Nobody to challenge');
  });

  it('are not shown at all where the venue switched them off, and older servers show none', () => {
    mount({ data: prep({ risks: { cover: false, duel: null, pot: null } }) });
    for (const id of ['risk-cover', 'risk-pot', 'risk-duel'])
      expect(screen.queryByTestId(id)).toBeNull();
    cleanup();
    const old = prep();
    delete old.risks;
    mount({ data: old });
    expect(screen.queryByTestId('risk-cover')).toBeNull();
  });

  it('the committed screen shows the extras as chips', () => {
    mount({
      me: you('p1', {
        powers: powers(),
        commitment: {
          stake: 'RISK',
          doubleDown: false,
          sabotage: null,
          cover: true,
          pot: true,
          duel: { targetId: 'p2' },
        },
      }),
    });
    const text = screen.getByTestId('ctl-risk-committed').textContent ?? '';
    expect(text).toContain('Cover');
    expect(text).toContain('Pot');
    expect(text).toContain('Duel → Merve');
  });
});

describe('Stake Cap', () => {
  it('closes the top rungs with a reason and says who is not named', () => {
    mount({ me: you('p1', { powers: powers({ stakeCap: 'RISK' }) }) });
    expect(button('stake-HIGH').disabled).toBe(true);
    expect(button('stake-HIGH').textContent).toContain('Closed this round');
    expect(button('stake-RISK').disabled).toBe(false);
    expect(screen.getByTestId('stake-cap-note').textContent).toBe(
      'A rival capped your stake: Risk at most.',
    );
  });
});

describe('Duel invites', () => {
  const invited = (answer: 'ACCEPTED' | 'DECLINED' | null = null) =>
    you('p1', { powers: powers(), duelInvites: [{ challengerId: 'p0', answer }] });

  it('show who challenges you, the rule and two big buttons', () => {
    const { onRespond } = mount({ me: invited() });
    const box = screen.getByTestId('duel-invite');
    expect(box.textContent).toContain('Ece challenges you to a Duel!');
    expect(box.textContent).toContain('80 points change hands');
    fireEvent.click(screen.getByTestId('duel-accept'));
    expect(onRespond).toHaveBeenCalledWith('p0', true);
    fireEvent.click(screen.getByTestId('duel-decline'));
    expect(onRespond).toHaveBeenCalledWith('p0', false);
  });

  it('accepting is grey, with the reason, once you hold a big gamble', () => {
    mount({
      me: you('p1', {
        powers: powers(),
        duelInvites: [{ challengerId: 'p0', answer: null }],
        commitment: { stake: 'HIGH', doubleDown: false, sabotage: null },
      }),
    });
    expect(button('duel-accept').disabled).toBe(true);
    expect(screen.getByTestId('duel-invite').textContent).toContain('One big gamble per question');
    expect(button('duel-decline').disabled).toBe(false);
  });

  it('an accepted duel closes the big stakes and Double Down for this player', () => {
    mount({ me: invited('ACCEPTED') });
    expect(screen.getByTestId('duel-invite').textContent).toContain('You accepted the Duel');
    expect(screen.queryByTestId('duel-accept')).toBeNull();
    expect(button('stake-HIGH').disabled).toBe(true);
    expect(button('prep-double-down').disabled).toBe(true);
    expect(button('risk-duel').disabled).toBe(true);
  });

  it('shows the invite on the committed screen too, so a locked-in player can still answer', () => {
    mount({
      me: you('p1', {
        powers: powers(),
        duelInvites: [{ challengerId: 'p0', answer: null }],
        commitment: { stake: 'RISK', doubleDown: false, sabotage: null },
      }),
    });
    expect(screen.getByTestId('ctl-risk-committed')).toBeTruthy();
    expect(screen.getByTestId('duel-invite')).toBeTruthy();
    expect(button('duel-accept').disabled).toBe(false);
  });

  it('shows the server refusal in plain words', async () => {
    const failure = Object.assign(new Error('refused'), { code: 'BIG_GAMBLE_CONFLICT' });
    mount({ me: invited(), onRespond: vi.fn().mockRejectedValue(failure) });
    fireEvent.click(screen.getByTestId('duel-accept'));
    await waitFor(() =>
      expect(screen.getByTestId('prep-error').textContent).toBe(
        'One big gamble per question: not together.',
      ),
    );
  });
});
