import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createState,
  execute,
  hostView,
  teamBadge,
  validateConfig,
  type Command,
  type QState,
  type QuizConfig,
} from '@quizparty/quiznight';
import { I18nProvider } from '../../lib/i18n';
import { parsePoolCsv } from './api';
import { QuizNightTab } from './QuizNightTab';
import { Present } from './Present';
import type { NightDetail } from './api';

/**
 * The host tablet (ADR-0029) against a fetch double that speaks the real wire contract and answers with
 * the real engine, so what is asserted is what the server would do.
 */
const q = (id: string) => ({
  id,
  text: `Soru ${id}?`,
  answer: { type: 'TEXT' as const, text: `Cevap ${id}` },
  points: 1,
  jokerAllowed: true,
});
const baseConfig: QuizConfig = {
  title: 'Cuma Gecesi',
  date: '2026-11-06',
  rounds: [
    { id: 'r1', kind: 'NORMAL', title: 'Genel kültür', questions: [q('a'), q('b'), q('c')] },
  ],
  tieBreak: null,
  teams: [1, 2].map((n) => ({ id: `t${n}`, name: `Takım ${n}`, badge: teamBadge(n), table: n })),
  settings: {
    jokersPerTeam: 1,
    wrongDoublePenalty: false,
    timerSec: 30,
    halfTimeAfterRound: 0,
    entranceText: '',
    prizeText: 'Bir içecek',
  },
};

let config: QuizConfig = baseConfig;

interface Sent {
  url: string;
  method: string;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
let sent: Sent[] = [];
let state: QState;
let rewardIssued = false;

function nightDetail(): NightDetail {
  return {
    id: 'n1',
    title: config.title,
    date: config.date,
    status: state.started ? 'LIVE' : 'READY',
    rounds: 1,
    questions: 3,
    teams: 2,
    config,
    issues: validateConfig(config),
    host: hostView(state, Date.now()),
    reward: null,
  };
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      sent.push({ url, method, body });
      const json = (data: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(data), { status }));
      if (url.endsWith('/command')) {
        const o = execute(state, body.cmd as Command, { now: Date.now(), actor: 'owner' });
        if (!o.ok)
          return json({ error: { code: 'QUIZNIGHT_REFUSED', params: { reason: o.error } } }, 409);
        state = o.state;
        return json({ host: hostView(state, Date.now()), seq: state.seq });
      }
      if (url.endsWith('/state')) return json({ host: hostView(state, Date.now()) });
      if (url.endsWith('/reward')) {
        rewardIssued = true;
        return json({ code: 'ABCD2345', teamName: 'Takım 1', text: 'Bir içecek' }, 201);
      }
      if (url.endsWith('/links')) return json({ url: 'http://tv/tv/gece?l=abc' }, 201);
      if (url.endsWith('/quiznights') && method === 'GET') return json({ nights: [] });
      if (url.endsWith('/quiznights') && method === 'POST')
        return json({ night: { ...nightDetail(), config: body } }, 201);
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    }),
  );
}

const commands = (): Command[] =>
  sent.filter((s) => s.url.endsWith('/command')).map((s) => s.body.cmd as Command);

beforeEach(() => {
  config = baseConfig;
  sent = [];
  rewardIssued = false;
  state = createState(config);
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const presentView = () =>
  render(
    <I18nProvider locale="tr">
      <Present venueId="v1" night={nightDetail()} onChanged={() => undefined} />
    </I18nProvider>,
  );

describe('Quiz night host tablet', () => {
  it('creates a night from the Hızlı template: two rounds of eight questions', async () => {
    render(
      <I18nProvider locale="tr">
        <QuizNightTab venueId="v1" />
      </I18nProvider>,
    );
    await screen.findByTestId('qn-tab');
    fireEvent.change(screen.getByTestId('qn-template'), { target: { value: 'QUICK' } });
    fireEvent.click(screen.getByTestId('qn-create'));
    await waitFor(() => expect(sent.some((s) => s.method === 'POST')).toBe(true));
    const created = sent.find((s) => s.method === 'POST')!.body as QuizConfig;
    expect(created.rounds).toHaveLength(2);
    expect(created.rounds.map((r) => r.questions.length)).toEqual([8, 8]);
    expect(created.rounds[0]!.title).toBe('Tur 1');
    expect(created.settings.jokersPerTeam).toBe(2);
  });

  it('NEXT sends the sequence it saw (a double tap cannot skip a slide)', async () => {
    presentView();
    fireEvent.click(screen.getByTestId('qn-start'));
    await screen.findByTestId('qn-next');
    fireEvent.click(screen.getByTestId('qn-next'));
    await waitFor(() => expect(commands().filter((c) => c.type === 'NEXT')).toHaveLength(1));
    const call = sent.find((s) => s.body?.cmd?.type === 'NEXT')!;
    expect(call.body.expectedSeq).toBe(1);
    expect(screen.getByTestId('qn-step').textContent).toBe('Nasıl oynanır?');
  });

  it('the 2x picker targets the next unshown question, shows jokers left and locks on screen', async () => {
    presentView();
    fireEvent.click(screen.getByTestId('qn-start'));
    const pick = await screen.findByTestId('qn-joker-t1');
    expect(screen.getByTestId('qn-joker').textContent).toContain('Genel kültür, 1. soru');
    fireEvent.click(pick);
    await waitFor(() => expect(screen.getByTestId('qn-joker-t1').textContent).toContain('Hak yok'));
    expect(commands().at(-1)).toEqual({ type: 'JOKER', questionId: 'a', teamId: 't1', on: true });
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId('qn-next'));
      await waitFor(() => expect(commands().filter((c) => c.type === 'NEXT')).toHaveLength(i + 1));
    }
    // question a is on the TV: the picker now offers question b
    await waitFor(() =>
      expect(screen.getByTestId('qn-joker').textContent).toContain('Genel kültür, 2. soru'),
    );
  });

  it('marking: tapping a cell sends MARK and the row total follows the server', async () => {
    presentView();
    fireEvent.click(screen.getByTestId('qn-start'));
    await screen.findByTestId('qn-next');
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByTestId('qn-next'));
      await waitFor(() => expect(commands().filter((c) => c.type === 'NEXT')).toHaveLength(i + 1));
    }
    fireEvent.click(await screen.findByTestId('qn-cell-a-t2'));
    await waitFor(() => expect(screen.getByTestId('qn-pts-t2').textContent).toBe('1'));
    expect(commands().at(-1)).toEqual({ type: 'MARK', questionId: 'a', teamId: 't2', right: true });
    fireEvent.click(screen.getByTestId('qn-mode-COUNT'));
    const count = await screen.findByTestId('qn-count-t1');
    fireEvent.change(count, { target: { value: '2' } });
    await waitFor(() => expect(screen.getByTestId('qn-pts-t1').textContent).toBe('2'));
  });

  it('shows the prize only at the podium and the code only after the owner asks', async () => {
    presentView();
    expect(screen.queryByTestId('qn-prize')).toBeNull();
    fireEvent.click(screen.getByTestId('qn-start'));
    await screen.findByTestId('qn-next');
    for (let i = 0; i < 14; i++) {
      fireEvent.click(screen.getByTestId('qn-next'));
      await waitFor(() => expect(commands().filter((c) => c.type === 'NEXT')).toHaveLength(i + 1));
    }
    const give = await screen.findByTestId('qn-prize');
    expect(give.textContent).not.toContain('ABCD2345');
    fireEvent.click(give.querySelector('button')!);
    await waitFor(() =>
      expect(screen.getByTestId('qn-prize-code').textContent).toContain('ABCD2345'),
    );
    expect(rewardIssued).toBe(true);
  });
});

describe('pool picker CSV', () => {
  it('reads the venue export: quoted cells, options and the correct letter', () => {
    const csv =
      String.fromCharCode(0xfeff) +
      'category,difficulty,question,optionA,optionB,optionC,optionD,optionE,optionF,correct,explanation\r\n' +
      'Tarih,EASY,"Hangisi, kesinlikle doğru?",Bir,İki,Üç,Dört,,,C,"Çünkü ""öyle"""\r\n' +
      'Tarih,EASY,Eksik,Bir,,,,,,A,\r\n';
    const rows = parsePoolCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question: 'Hangisi, kesinlikle doğru?',
      options: ['Bir', 'İki', 'Üç', 'Dört'],
      correctIndex: 2,
      explanation: 'Çünkü "öyle"',
    });
  });
});

describe('Quiz night host tablet: paper-night rules', () => {
  const finalConfig = (): QuizConfig => ({
    ...baseConfig,
    finalWager: { category: 'Tarih', question: { ...q('fin'), points: 0 } },
    settings: { ...baseConfig.settings, nameBonus: 2, wagerCap: 5 },
  });
  const advance = (...cmds: Command[]): void => {
    for (const cmd of cmds) {
      const o = execute(state, cmd, { now: Date.now(), actor: 'owner' });
      if (!o.ok) throw new Error(`${cmd.type}: ${o.error}`);
      state = o.state;
    }
  };
  const next = (n: number): Command[] => Array.from({ length: n }, () => ({ type: 'NEXT' }));
  // INTRO, HOWTO, ROUND_TITLE, a, b, c, LOCKED, SWAP, 3 answers, MARKING, ROUND_SCORES, STANDINGS, FINAL_INTRO
  const toFinalIntro = (): void => {
    config = finalConfig();
    state = createState(config);
    advance({ type: 'START' }, ...next(7));
    advance(
      { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'b', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'a', teamId: 't2', right: true },
    );
    advance(...next(7));
  };

  it('the team-name bonus toggle sends TEAM_NAME_BONUS and shows the points', async () => {
    config = finalConfig();
    state = createState(config);
    advance({ type: 'START' });
    presentView();
    expect(screen.getByTestId('qn-bonus').textContent).toContain('+2 puan');
    fireEvent.click(screen.getByTestId('qn-bonus-t2'));
    await waitFor(() =>
      expect(commands()).toContainEqual({ type: 'TEAM_NAME_BONUS', teamId: 't2', on: true }),
    );
  });

  it('final intro: stakes are typed per team with their limit; too high is refused by the server', async () => {
    toFinalIntro();
    presentView();
    const box = screen.getByTestId('qn-final');
    expect(box.textContent).toContain('Final bahsi: Tarih');
    expect(screen.getByTestId('qn-final-t1').textContent).toContain('en fazla 2');
    const input = screen.getByTestId('qn-wager-t1');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(commands()).toContainEqual({ type: 'WAGER', teamId: 't1', amount: 2 }),
    );
    fireEvent.change(screen.getByTestId('qn-wager-t2'), { target: { value: '4' } });
    fireEvent.blur(screen.getByTestId('qn-wager-t2'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Bahis, takımın puanından'),
    );
  });

  it('after the answer slide the host marks right or wrong per team and sees the result', async () => {
    toFinalIntro();
    advance({ type: 'WAGER', teamId: 't1', amount: 2 }, ...next(2));
    presentView();
    expect(screen.getByTestId('qn-final').textContent).toContain('Cevap: Cevap fin');
    fireEvent.click(screen.getByTestId('qn-final-right-t1'));
    await waitFor(() =>
      expect(commands()).toContainEqual({
        type: 'MARK',
        questionId: 'final-wager',
        teamId: 't1',
        right: true,
      }),
    );
    await waitFor(() => expect(screen.getByTestId('qn-final-t1').textContent).toContain('2 puan'));
  });

  it('the final card is absent on a night without a final', () => {
    advance({ type: 'START' });
    presentView();
    expect(screen.queryByTestId('qn-final')).toBeNull();
    expect(screen.queryByTestId('qn-bonus')).toBeNull();
  });
});
