import { useEffect, useRef } from 'react';
import type {
  CategoryCatalog,
  DifficultyPreset,
  PlayMode,
  RoomView,
  Ruleset,
} from '@quizparty/protocol';
import { Button } from '../../ui/Button';
import { Panel, Pill } from '../../ui/Panel';
import { Sticker } from '../../ui/Sticker';
import { categoryIcon } from '../../lib/assets';
import { useI18n } from '../../lib/i18n';
import styles from './TvSettings.module.css';
import { cx } from '../../lib/cx';

export const ROUND_CHOICES = [5, 10, 15, 20] as const;
const DIFFICULTIES: readonly DifficultyPreset[] = ['EASY', 'MEDIUM', 'HARD'];

interface Props {
  room: RoomView;
  catalog: CategoryCatalog | null;
  onChange: (change: {
    rounds?: number;
    difficulty?: DifficultyPreset;
    categories?: 'ALL' | string[];
    play?: PlayMode;
    ruleset?: Ruleset;
    teamCount?: number;
  }) => void;
  onClose: () => void;
}

/** "Kategori Seçin": category tiles, question count and difficulty (every change applies at once). */
export function TvSettings({ room, catalog, onChange, onClose }: Props) {
  const { t, td } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const free = room.tier === 'FREE';
  const selected = room.settings.categories;
  const isAll = selected === 'ALL';

  const toggle = (id: string): void => {
    if (isAll) {
      onChange({ categories: [id] });
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((entry) => entry !== id)
      : [...selected, id];
    onChange({ categories: next.length === 0 ? 'ALL' : next });
  };

  return (
    <div className={styles.scrim}>
      <Panel className={styles.panel} role="dialog" aria-modal="true" data-testid="tv-settings">
        <h2 className={styles.title}>{t('settings.chooseCategory')}</h2>
        <div className={styles.grid}>
          <button
            type="button"
            className={cx(styles.tile, isAll && styles.on)}
            onClick={() => onChange({ categories: 'ALL' })}
            aria-pressed={isAll}
            data-focusable
            data-testid="category-all"
          >
            <Sticker id="cat-mixed" size={92} />
            <span className={styles.tileLabel}>{t('settings.mixed')}</span>
          </button>
          {(catalog?.categories ?? []).map((category) => {
            const locked = free && !category.free;
            const on = !isAll && selected.includes(category.id);
            return (
              <button
                key={category.id}
                type="button"
                className={cx(styles.tile, on && styles.on, locked && styles.locked)}
                onClick={() => toggle(category.id)}
                disabled={locked}
                aria-pressed={on}
                data-focusable
                data-testid={`category-${category.id}`}
              >
                <Sticker id={categoryIcon(category.id)} size={92} />
                <span className={styles.tileLabel}>{category.label}</span>
                {locked ? <Sticker id="lock" size={40} className={styles.lock} /> : null}
              </button>
            );
          })}
        </div>

        <div className={styles.options}>
          <div className={styles.group}>
            <span className={styles.groupLabel}>{t('settings.questions')}</span>
            {ROUND_CHOICES.map((count) => (
              <Pill
                key={count}
                selected={room.settings.rounds === count}
                locked={count > room.limits.maxRounds}
                disabled={count > room.limits.maxRounds}
                onClick={() => onChange({ rounds: count })}
              >
                {count}
              </Pill>
            ))}
          </div>
          <div className={styles.group}>
            <span className={styles.groupLabel}>{t('settings.difficulty')}</span>
            {DIFFICULTIES.map((preset) => (
              <Pill
                key={preset}
                selected={room.settings.difficulty === preset}
                onClick={() => onChange({ difficulty: preset })}
              >
                {td(`settings.preset.${preset}`)}
              </Pill>
            ))}
          </div>
        </div>
        {/* ADR-0026: how the table plays - alone or in teams, with the whole menu or the simple one */}
        <div className={styles.options} data-testid="tv-play-options">
          <div className={styles.group}>
            <span className={styles.groupLabel}>{t('teams.mode.title')}</span>
            {(['INDIVIDUAL', 'TEAMS'] as const).map((play) => (
              <Pill
                key={play}
                selected={(room.settings.play ?? 'INDIVIDUAL') === play}
                onClick={() => onChange({ play })}
              >
                {td(`teams.mode.${play}`)}
              </Pill>
            ))}
          </div>
          {room.settings.play === 'TEAMS' ? (
            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('teams.count.title')}</span>
              {[2, 3, 4].map((count) => (
                <Pill
                  key={count}
                  selected={(room.settings.teamCount ?? 2) === count}
                  onClick={() => onChange({ teamCount: count })}
                >
                  {count}
                </Pill>
              ))}
            </div>
          ) : null}
          <div className={styles.group}>
            <span className={styles.groupLabel}>{t('teams.ruleset.title')}</span>
            {(['FULL', 'SIMPLE'] as const).map((ruleset) => (
              <Pill
                key={ruleset}
                selected={(room.settings.ruleset ?? 'FULL') === ruleset}
                onClick={() => onChange({ ruleset })}
              >
                {td(`teams.ruleset.${ruleset}`)}
              </Pill>
            ))}
          </div>
        </div>
        {free ? <div className={styles.upsell}>{t('settings.freeHint')}</div> : null}
        <Button
          ref={closeRef}
          size="lg"
          onClick={onClose}
          className={styles.done}
          data-testid="settings-done"
        >
          {t('settings.done')}
        </Button>
      </Panel>
    </div>
  );
}
