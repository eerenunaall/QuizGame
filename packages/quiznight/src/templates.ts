import type { QuestionDef, QuizConfig, RoundDef, TeamDef } from './types';

export type TemplateId = 'CLASSIC' | 'QUICK' | 'BLANK';

export interface TemplateLabels {
  /** Title of round n (1-based). */
  round: (n: number) => string;
  final: string;
}

export const DEFAULT_SETTINGS: QuizConfig['settings'] = {
  jokersPerTeam: 2,
  wrongDoublePenalty: false,
  timerSec: 30,
  halfTimeAfterRound: 0,
  entranceText: '',
  prizeText: '',
};

const BADGE_COLORS = [
  '#e4572e',
  '#29a8ab',
  '#f3a712',
  '#6a4c93',
  '#3a86ff',
  '#2d936c',
  '#d6336c',
  '#7f5539',
];
const BADGE_EMOJI = ['🦁', '🐺', '🦊', '🐼', '🦉', '🐯', '🦅', '🐬'];

/** Colour + emoji until venue logos exist (ADR-0027); stable by index so a re-render never reshuffles. */
export const teamBadge = (i: number): TeamDef['badge'] => ({
  color: BADGE_COLORS[i % BADGE_COLORS.length]!,
  emoji: BADGE_EMOJI[i % BADGE_EMOJI.length]!,
});

export function blankQuestion(id: string, points = 1): QuestionDef {
  return { id, text: '', answer: { type: 'TEXT', text: '' }, points, jokerAllowed: true };
}

export function blankRound(
  id: string,
  title: string,
  kind: RoundDef['kind'],
  questions: QuestionDef[],
): RoundDef {
  return { id, kind, title, questions };
}

/** Injected id factory keeps the pure module free of randomness. */
export function templateConfig(
  id: TemplateId,
  o: { title: string; date: string; newId: () => string; labels: TemplateLabels },
): QuizConfig {
  const mk = (n: number): QuestionDef[] =>
    Array.from({ length: n }, () => blankQuestion(o.newId()));
  const rounds: RoundDef[] = [];
  let halfTime = 0;
  if (id === 'CLASSIC') {
    for (let i = 1; i <= 4; i++)
      rounds.push(blankRound(o.newId(), o.labels.round(i), 'NORMAL', mk(10)));
    rounds.push(
      blankRound(
        o.newId(),
        o.labels.final,
        'BONUS',
        mk(5).map((q) => ({ ...q, points: 2, jokerAllowed: false })),
      ),
    );
    halfTime = 2;
  } else if (id === 'QUICK') {
    for (let i = 1; i <= 2; i++)
      rounds.push(blankRound(o.newId(), o.labels.round(i), 'NORMAL', mk(8)));
  }
  return {
    title: o.title,
    date: o.date,
    rounds,
    tieBreak: null,
    teams: [],
    settings: { ...DEFAULT_SETTINGS, halfTimeAfterRound: halfTime },
  };
}
