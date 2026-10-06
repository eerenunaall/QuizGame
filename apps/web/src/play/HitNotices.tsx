import type { YouView } from '@quizparty/protocol';
import { Sticker } from '../ui/Sticker';
import { useI18n } from '../lib/i18n';
import { SABOTAGE_STICKER, jamSeconds } from './powers';
import styles from './HitNotices.module.css';
import { cx } from '../lib/cx';

/** What other players did to this phone this round, in plain words. Never names the attacker. */
export function HitNotices({ you }: { you: YouView | null }) {
  const { t, td } = useI18n();
  if (!you || you.hits.length === 0) return null;
  const effects = you.effects;
  return (
    <div className={styles.list} data-testid="hit-notices">
      {you.hits.map((hit, index) => {
        const softened =
          !hit.blocked &&
          (hit.effect === 'SHUFFLE' || hit.effect === 'FOG') &&
          effects !== null &&
          effects.order === null &&
          effects.fogOptionId === null &&
          effects.jamMs > 0;
        const text = hit.blocked
          ? t('ctl.hit.blocked', { effect: td(`sabotage.${hit.effect}`) })
          : softened
            ? t('ctl.hit.softened', { seconds: jamSeconds(effects.jamMs) })
            : hit.effect === 'JAM'
              ? t('ctl.hit.JAM', { seconds: jamSeconds(effects?.jamMs ?? 0) })
              : td(`ctl.hit.${hit.effect}`);
        return (
          <div
            key={`${hit.effect}-${index}`}
            className={cx(styles.notice, hit.blocked && styles.blocked)}
            role="status"
          >
            <Sticker id={hit.blocked ? 'shield' : SABOTAGE_STICKER[hit.effect]} size={34} />
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
