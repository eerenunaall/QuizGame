import type { ReactNode } from 'react';
import type { Difficulty, PublicOption, PublicPlayer, RoomView } from '@quizparty/protocol';
import { AnswerCard, type AnswerState } from '../../ui/AnswerCard';
import { Avatar } from '../../ui/Avatar';
import { CountdownRing } from '../../ui/CountdownRing';
import { Sticker } from '../../ui/Sticker';
import { categoryIcon } from '../../lib/assets';
import { useI18n } from '../../lib/i18n';
import styles from './TvQuestion.module.css';
import { cx } from '../../lib/cx';

export function questionFontSize(text: string): number {
  if (text.length <= 55) return 62;
  if (text.length <= 100) return 54;
  if (text.length <= 160) return 46;
  return 40;
}

/**
 * Answer text size. The card is a fixed 160 px tall, so longer answers step down to stay inside it;
 * `compact` is for the reveal, where the faces of the players who picked the option take some width.
 */
export function answerFontSize(text: string, compact: boolean): number {
  const length = text.length;
  if (compact) return length <= 17 ? 46 : length <= 36 ? 40 : length <= 60 ? 34 : 29;
  return length <= 24 ? 46 : length <= 48 ? 42 : length <= 80 ? 36 : 30;
}

export function explanationFontSize(text: string): number {
  if (text.length <= 90) return 44;
  if (text.length <= 160) return 38;
  if (text.length <= 260) return 32;
  return 28;
}

export type CrowdSummary =
  { kind: 'majority'; optionId: string; right: boolean } | { kind: 'split' } | null;

/** CROWD rounds: what the room as a whole thought, and whether it was right. */
export function crowdSummary(
  distribution: readonly { optionId: string; count: number }[],
  correctOptionId: string,
): CrowdSummary {
  const total = distribution.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return null;
  const top = Math.max(...distribution.map((entry) => entry.count));
  const leaders = distribution.filter((entry) => entry.count === top);
  if (leaders.length > 1) return { kind: 'split' };
  const leader = leaders[0]!;
  return {
    kind: 'majority',
    optionId: leader.optionId,
    right: leader.optionId === correctOptionId,
  };
}

/** Share of the votes an option got, as a whole percentage (0 when nobody voted). */
export function votePercent(count: number, total: number): number {
  return total <= 0 ? 0 : Math.round((count * 100) / total);
}

/** At most three faces fit on an answer card; more players collapse into a "+N" chip. */
export const MAX_CHOOSER_FACES = 3;

interface Props {
  room: RoomView;
  category?: { id: string; label: string } | undefined;
  difficulty?: Difficulty | undefined;
  text: string;
  options?: readonly PublicOption[];
  /** Ring timer: shown while answering. */
  timer?: {
    now: () => number;
    startAt: number;
    deadlineAt: number;
    onSecond?: (seconds: number) => void;
  };
  /** Status line under the question ("Cevaplar alınıyor…", "KİLİTLENDİ!", "DOĞRU CEVAP"). */
  status?: {
    tone: 'info' | 'gold' | 'success';
    text: string;
    icon?: 'lock' | 'check' | 'hourglass';
  };
  reveal?: {
    correctOptionId: string;
    distribution: readonly { optionId: string; count: number }[];
    results: readonly { playerId: string; optionId: string | null }[];
    explanation: string | null;
  };
  /** CROWD round: every card also shows the share of votes it got. */
  crowd?: boolean;
  /** Extra content rendered between status and answers. */
  children?: ReactNode;
}

const stateFor = (option: PublicOption, reveal: Props['reveal']): AnswerState => {
  if (!reveal) return 'idle';
  return option.optionId === reveal.correctOptionId ? 'correct' : 'dim';
};

function CrowdBar({ percent }: { percent: number }) {
  return (
    <>
      <span className={styles.crowdPct} data-testid="crowd-percent">
        {percent}%
      </span>
      <span
        className={styles.crowdBar}
        style={{ ['--qp-pct' as string]: percent / 100 }}
        aria-hidden="true"
      />
    </>
  );
}

function ChooserFaces({ players }: { players: readonly PublicPlayer[] }) {
  const overflow = players.length > MAX_CHOOSER_FACES;
  const shown = overflow ? players.slice(0, MAX_CHOOSER_FACES - 1) : players;
  const extra = players.length - shown.length;
  return (
    <span className={styles.choosers} data-testid="tv-choosers">
      {shown.map((player) => (
        <span key={player.playerId} className={styles.chooser}>
          <Avatar avatarId={player.avatarId} size={46} colorSlot={player.colorSlot} />
        </span>
      ))}
      {extra > 0 ? <span className={cx(styles.chooser, styles.more)}>+{extra}</span> : null}
    </span>
  );
}

/** Shared TV layout for reading, answering, locked and reveal: question card, status, answer grid, timer. */
export function TvQuestion({
  room,
  category,
  difficulty,
  text,
  options,
  timer,
  status,
  reveal,
  crowd,
  children,
}: Props) {
  const { t, td } = useI18n();
  const playersById = new Map<string, PublicPlayer>(
    room.players.map((player) => [player.playerId, player]),
  );
  const choosers = (optionId: string): PublicPlayer[] =>
    (reveal?.results ?? [])
      .filter((result) => result.optionId === optionId)
      .map((result) => playersById.get(result.playerId))
      .filter((player): player is PublicPlayer => player !== undefined);
  const explanation = reveal?.explanation?.trim() ? reveal.explanation.trim() : null;
  const votes = reveal?.distribution.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
  const countOf = (optionId: string): number =>
    reveal?.distribution.find((entry) => entry.optionId === optionId)?.count ?? 0;

  return (
    <div className={styles.screen}>
      {category ? (
        <div className={styles.meta}>
          <Sticker id={categoryIcon(category.id)} size={64} />
          <span className={styles.category}>{category.label}</span>
          {difficulty ? (
            <span className={styles.difficulty}>{td(`game.difficulty.${difficulty}`)}</span>
          ) : null}
        </div>
      ) : null}

      <div className={cx(styles.question, explanation && styles.questionOut)} key={text}>
        <div
          className={styles.questionText}
          style={{ fontSize: questionFontSize(text) }}
          data-testid="tv-question"
        >
          {text}
        </div>
      </div>

      {explanation ? (
        <div className={styles.explain} data-testid="tv-explanation">
          <Sticker id="light-bulb" size={96} className={styles.explainIcon} />
          <div className={styles.explainBody}>
            <div className={styles.explainLabel}>{t('game.reveal.didYouKnow')}</div>
            <div
              className={styles.explainText}
              style={{ fontSize: explanationFontSize(explanation) }}
            >
              {explanation}
            </div>
          </div>
        </div>
      ) : null}

      {timer ? (
        <div className={styles.timer}>
          <CountdownRing
            now={timer.now}
            startAt={timer.startAt}
            deadlineAt={timer.deadlineAt}
            {...(timer.onSecond ? { onSecond: timer.onSecond } : {})}
          />
        </div>
      ) : null}

      {status ? (
        <div
          className={cx(styles.status, styles[status.tone])}
          key={status.text}
          data-testid="tv-status"
        >
          {status.icon ? (
            <Sticker
              id={status.icon === 'lock' ? 'lock' : status.icon === 'check' ? 'check' : 'hourglass'}
              size={52}
            />
          ) : null}
          <span>{status.text}</span>
        </div>
      ) : null}

      {options ? (
        <div
          className={cx(styles.grid, options.length <= 2 && styles.two)}
          data-testid="tv-options"
        >
          {options.map((option, index) => {
            const picked = reveal ? choosers(option.optionId) : [];
            return (
              <div
                key={option.optionId}
                className={styles.cell}
                style={{ ['--qp-delay' as string]: `${index * 90}ms` }}
              >
                <AnswerCard
                  index={index}
                  text={option.text}
                  state={stateFor(option, reveal)}
                  textSize={answerFontSize(option.text, picked.length > 0)}
                >
                  {picked.length > 0 ? <ChooserFaces players={picked} /> : null}
                  {crowd && reveal ? (
                    <CrowdBar percent={votePercent(countOf(option.optionId), votes)} />
                  ) : null}
                </AnswerCard>
              </div>
            );
          })}
        </div>
      ) : null}

      {children}
    </div>
  );
}
