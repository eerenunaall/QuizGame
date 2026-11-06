import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { Sticker } from '../ui/Sticker';
import { TimerBar } from '../ui/TimerBar';
import { categoryIcon } from '../lib/assets';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';
import styles from './PickScreen.module.css';

type PickData = PhaseDataOf<'RISK_PICK'> | PhaseDataOf<'SABOTAGE_PICK'>;

/**
 * Top of both timed pick screens (ADR-0022): the category row, a loud title, the clock and a one-line
 * rule. The question text is never here: it stays on the TV (owner rule).
 */
export function PickHeader({
  room,
  data,
  now,
  title,
  rule,
  kind,
}: {
  room: RoomView;
  data: PickData;
  now: () => number;
  title: string;
  rule: string;
  kind: 'risk' | 'sabotage';
}) {
  const { t, td } = useI18n();
  return (
    <>
      <div className={styles.head}>
        <Sticker id={categoryIcon(data.category.id)} size={60} />
        <div className={styles.headText}>
          <div className={styles.kicker}>
            {t('game.round.of', { n: data.round.index + 1, total: data.round.total })} ·{' '}
            {td(`game.kind.${data.round.kind}`)}
          </div>
          <div className={styles.category}>{data.category.label}</div>
        </div>
        <div className={styles.difficulty}>{td(`game.difficulty.${data.difficulty}`)}</div>
      </div>
      <div
        className={cx(
          styles.pickTitle,
          kind === 'sabotage' ? styles.pickSabotage : styles.pickRisk,
        )}
        data-testid="pick-title"
      >
        {title}
      </div>
      {room.phaseDeadlineAt !== null ? (
        <div className={styles.timer}>
          <TimerBar
            size="lg"
            now={now}
            startAt={room.phaseEnteredAt}
            deadlineAt={room.phaseDeadlineAt}
          />
        </div>
      ) : null}
      <div className={styles.rule} data-testid="pick-rule">
        {rule}
      </div>
    </>
  );
}

/**
 * "Who has locked in", as a count only: one tick per player, the first `done` ticked. Nothing here
 * says which player committed what (ATTACK 27).
 */
export function PickTicks({ done, total }: { done: number; total: number }) {
  const { t } = useI18n();
  const count = Math.max(total, done);
  return (
    <div className={styles.waiting} data-testid="pick-waiting">
      <div className={styles.ticks} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className={cx(styles.tick, index < done && styles.tickOn)} />
        ))}
      </div>
      <span>{t('ctl.prep.waiting', { done, total: count })}</span>
    </div>
  );
}
