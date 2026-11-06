import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { useI18n } from '../../lib/i18n';
import { nightsApi, type NightDetail } from './api';
import { Prepare } from './Prepare';
import { Present } from './Present';
import { useNightError } from './QuizNightTab';
import styles from './quiznight.module.css';

type Mode = 'prepare' | 'present';

/** One night: Hazırlık before it starts, Sunum once it is live or finished (ADR-0029 §1). */
export function NightScreen({
  venueId,
  nightId,
  onClose,
}: {
  venueId: string;
  nightId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const describe = useNightError();
  const [night, setNight] = useState<NightDetail | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { night: fresh } = await nightsApi.detail(venueId, nightId);
      setNight(fresh);
      setMode(
        (m) =>
          m ?? (fresh.status === 'LIVE' || fresh.status === 'FINISHED' ? 'present' : 'prepare'),
      );
    } catch (e) {
      setError(describe(e));
    }
  }, [venueId, nightId, describe]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!night || !mode) return <p>…</p>;
  return (
    <div data-testid="qn-night">
      <div className={styles.toolbar}>
        <Button size="md" variant="ghost" onClick={onClose}>
          {t('qn.backToList')}
        </Button>
        <strong className={styles.nightTitle}>{night.title}</strong>
      </div>
      <div className={styles.subTabs}>
        {(['prepare', 'present'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={id === mode ? styles.subTabOn : styles.subTab}
            onClick={() => {
              setMode(id);
              void load();
            }}
            data-testid={`qn-mode-${id}`}
          >
            {t(`qn.tab.${id}`)}
          </button>
        ))}
      </div>
      {mode === 'prepare' ? (
        <Prepare
          venueId={venueId}
          night={night}
          onSaved={setNight}
          onGoPresent={() => setMode('present')}
        />
      ) : (
        <Present venueId={venueId} night={night} onChanged={() => void load()} />
      )}
    </div>
  );
}
