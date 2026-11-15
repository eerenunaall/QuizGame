import { execute, teamBadge, type Command, type QState, type QuizConfig } from './index';

export const q = (
  id: string,
  points = 1,
  over: Partial<QuizConfig['rounds'][0]['questions'][0]> = {},
) => ({
  id,
  text: `Soru ${id}`,
  answer: { type: 'TEXT' as const, text: `Cevap ${id}` },
  points,
  jokerAllowed: true,
  ...over,
});

export function fixture(over: Partial<QuizConfig['settings']> = {}, tie = true): QuizConfig {
  return {
    title: 'Test Gecesi',
    date: '2026-11-06',
    rounds: [
      { id: 'r1', kind: 'NORMAL', title: 'Tur 1', questions: [q('a', 1), q('b', 1), q('c', 2)] },
      {
        id: 'r2',
        kind: 'ESTIMATE',
        title: 'Tahmin',
        questions: [q('e', 3, { answer: { type: 'NUMBER', value: 100 }, jokerAllowed: false })],
      },
    ],
    tieBreak: tie
      ? q('tie-break', 0, { answer: { type: 'NUMBER', value: 50 }, jokerAllowed: false })
      : null,
    teams: [1, 2, 3].map((n) => ({
      id: `t${n}`,
      name: `Takım ${n}`,
      badge: teamBadge(n),
      table: n,
    })),
    settings: {
      jokersPerTeam: 2,
      wrongDoublePenalty: false,
      timerSec: 30,
      halfTimeAfterRound: 0,
      entranceText: '',
      prizeText: '',
      ...over,
    },
  };
}

let clock = 1_000;
export function run(state: QState, ...cmds: Command[]): QState {
  let s = state;
  for (const cmd of cmds) {
    const o = execute(s, cmd, { now: (clock += 1000), actor: 'host' });
    if (!o.ok) throw new Error(`${cmd.type} -> ${o.error}`);
    s = o.state;
  }
  return s;
}
