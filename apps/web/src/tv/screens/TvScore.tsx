import { useEffect, useRef, useState } from 'react';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { CountUp } from '../../ui/CountUp';
import { Sticker } from '../../ui/Sticker';
import { useFlip } from '../../lib/motion';
import { useI18n } from '../../lib/i18n';
import styles from './TvScore.module.css';
import { cx } from '../../lib/cx';

type ScoreData = PhaseDataOf<'SCORE_UPDATE'>;
type Delta = ScoreData['deltas'][number];

/** Rows first show the previous order and points earned, then glide into the new order. */
export const SETTLE_MS = 1500;

const LIST_HEIGHT = 780;
const MAX_ROW_HEIGHT = 100;
const ROW_GAP = 14;

/** Row size that keeps up to eight players on one screen (the stage is 1080 px tall). */
export function rowHeightFor(count: number): number {
  const pitch = Math.min(MAX_ROW_HEIGHT + ROW_GAP, Math.floor(LIST_HEIGHT / Math.max(1, count)));
  return pitch - ROW_GAP;
}

/** The crown is for whoever leads with points on the board; a 0–0 tie has no leader yet. */
export function isCrowned(delta: Delta, settled: boolean): boolean {
  const rank = settled ? delta.rank : delta.previousRank;
  const total = settled ? delta.total : delta.total - delta.delta;
  return rank === 1 && total > 0;
}

/**
 * Score update: rows start in the previous order, show the points just earned, then glide into the
 * new order (FLIP). The server already ranks; this only animates the change.
 */
export function TvScoreUpdate({
  room,
  data,
  onRankChange,
}: {
  room: RoomView;
  data: ScoreData;
  onRankChange?: () => void;
}) {
  const { t } = useI18n();
  const [settled, setSettled] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The callback is usually an inline arrow: keep it out of the effect so re-renders cannot restart the timer.
  const rankChange = useRef(onRankChange);
  rankChange.current = onRankChange;

  useEffect(() => {
    setSettled(false);
    const id = window.setTimeout(() => {
      setSettled(true);
      if (data.deltas.some((delta) => delta.rank < delta.previousRank)) rankChange.current?.();
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [data]);

  const players = new Map(room.players.map((player) => [player.playerId, player]));
  const rows = [...data.deltas]
    .sort((a, b) => (settled ? a.rank - b.rank : a.previousRank - b.previousRank))
    .map((delta) => ({ delta, player: players.get(delta.playerId) }))
    .filter(
      (row): row is typeof row & { player: NonNullable<typeof row.player> } =>
        row.player !== undefined,
    );
  useFlip(listRef, `${settled}:${rows.map((row) => row.delta.playerId).join(',')}`);

  const height = rowHeightFor(rows.length);

  return (
    <div className={styles.screen} data-testid="tv-score">
      <h1 className={styles.title}>{t('game.score.title')}</h1>
      <div ref={listRef} className={styles.list}>
        {rows.map(({ delta, player }, index) => {
          const rank = settled ? delta.rank : delta.previousRank;
          const gain = delta.delta;
          const crowned = isCrowned(delta, settled);
          return (
            <div
              key={delta.playerId}
              data-flip-key={delta.playerId}
              className={cx(styles.row, crowned && styles.first)}
              style={{
                height,
                marginBottom: ROW_GAP,
                ['--qp-row-h' as string]: `${height}px`,
                ['--qp-delay' as string]: `${index * 70}ms`,
              }}
              data-testid={`score-row-${player.nickname}`}
              data-rank={rank}
            >
              <span className={styles.rank}>
                {crowned ? <Sticker id="crown" size={Math.round(height * 0.64)} /> : rank}
              </span>
              <Avatar
                avatarId={player.avatarId}
                size={Math.min(78, height - 18)}
                colorSlot={player.colorSlot}
                playerId={player.playerId}
              />
              <span className={styles.name}>{player.nickname}</span>
              <span
                className={cx(
                  styles.delta,
                  gain > 0 ? styles.up : gain < 0 ? styles.down : styles.flat,
                )}
              >
                {gain > 0 ? `+${gain}` : gain < 0 ? String(gain) : '±0'}
              </span>
              <CountUp
                className={styles.total}
                value={delta.total}
                from={delta.total - gain}
                durationMs={1200}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
