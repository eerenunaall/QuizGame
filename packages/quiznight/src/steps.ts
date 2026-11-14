import type { QuizConfig, Step } from './types';

const cache = new WeakMap<QuizConfig, Step[]>();

/**
 * The fixed script of a night (ADR-0029 §2, research notes): intro, how-to, then per round
 * title → questions → pens down → paper swap → answers one by one → marking → round scores → standings
 * (+ half-time), the final wager (intro, question, answer, reveal), tie-break when needed, podium. The tie-break steps are skipped at run time unless
 * the top is actually tied.
 */
export function buildSteps(config: QuizConfig): Step[] {
  const hit = cache.get(config);
  if (hit) return hit;
  const steps: Step[] = [{ kind: 'INTRO' }, { kind: 'HOWTO' }];
  config.rounds.forEach((round, r) => {
    steps.push({ kind: 'ROUND_TITLE', round: r });
    round.questions.forEach((_, q) => steps.push({ kind: 'QUESTION', round: r, q }));
    steps.push({ kind: 'LOCKED', round: r });
    steps.push({ kind: 'SWAP', round: r });
    round.questions.forEach((_, q) => steps.push({ kind: 'ANSWER', round: r, q }));
    steps.push({ kind: 'MARKING', round: r });
    steps.push({ kind: 'ROUND_SCORES', round: r });
    steps.push({ kind: 'STANDINGS', round: r });
    if (
      config.settings.halfTimeAfterRound > 0 &&
      config.settings.halfTimeAfterRound === r + 1 &&
      r + 1 < config.rounds.length
    )
      steps.push({ kind: 'HALF_TIME', round: r });
  });
  if (config.finalWager)
    steps.push(
      { kind: 'FINAL_INTRO' },
      { kind: 'FINAL_QUESTION' },
      { kind: 'FINAL_ANSWER' },
      { kind: 'FINAL_REVEAL' },
    );
  if (config.tieBreak) steps.push({ kind: 'TIE_QUESTION' }, { kind: 'TIE_ANSWER' });
  steps.push({ kind: 'PODIUM' });
  cache.set(config, steps);
  return steps;
}

export function stepIndex(
  steps: readonly Step[],
  kind: Step['kind'],
  round?: number,
  q?: number,
): number {
  return steps.findIndex((s) => s.kind === kind && s.round === round && s.q === q);
}
