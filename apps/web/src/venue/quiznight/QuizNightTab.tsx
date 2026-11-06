import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { templateConfig, type TemplateId } from '@quizparty/quiznight';
import { Button } from '../../ui/Button';
import { AccountApiError } from '../../lib/account';
import { useI18n } from '../../lib/i18n';
import { nightsApi, type NightSummary } from './api';
import { NightScreen } from './NightScreen';
import styles from './quiznight.module.css';

/** Maps a refusal to plain words: the server says why in `params.reason` (ADR-0029). */
export function useNightError(): (error: unknown) => string {
  const { t, td } = useI18n();
  return useCallback(
    (error: unknown): string => {
      if (error instanceof AccountApiError) {
        const reason = error.params.reason;
        if (error.code === 'QUIZNIGHT_REFUSED' && typeof reason === 'string') {
          const message = td(`qn.err.${reason}`);
          return message.startsWith('qn.err.') ? t('qn.err.generic') : message;
        }
        if (error.code === 'RATE_LIMITED') return t('staff.error.throttled');
      }
      return t('qn.err.generic');
    },
    [t, td],
  );
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The owner's Quiz Gecesi tab (ADR-0029): a list of nights, a form to start a new one from a template,
 * and the night screen (Hazırlık / Sunum) for the one that is open.
 */
export function QuizNightTab({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const describe = useNightError();
  const [nights, setNights] = useState<NightSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(() => t('qn.defaultTitle'));
  const [date, setDate] = useState(today);
  const [template, setTemplate] = useState<TemplateId>('CLASSIC');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    nightsApi.list(venueId).then(
      (result) => setNights(result.nights),
      (e: unknown) => setError(describe(e)),
    );
  }, [venueId, describe]);
  useEffect(refresh, [refresh]);

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let n = 0;
      const config = templateConfig(template, {
        title,
        date,
        newId: () =>
          `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        labels: { round: (i) => t('qn.round', { n: i }), final: t('qn.final') },
      });
      const created = await nightsApi.create(venueId, config);
      setOpenId(created.night.id);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await nightsApi.remove(venueId, id);
      refresh();
    } catch (e) {
      setError(describe(e));
    }
  }

  if (openId)
    return (
      <NightScreen
        venueId={venueId}
        nightId={openId}
        onClose={() => {
          setOpenId(null);
          refresh();
        }}
      />
    );

  return (
    <div data-testid="qn-tab">
      <h2 className={styles.h2}>{t('qn.title')}</h2>
      <p className={styles.muted}>{t('qn.intro')}</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <form className={styles.card} onSubmit={(e) => void create(e)}>
        <h3 className={styles.h3}>{t('qn.new')}</h3>
        <label className={styles.field}>
          <span>{t('qn.new.title')}</span>
          <input
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="qn-new-title"
          />
        </label>
        <label className={styles.field}>
          <span>{t('qn.new.date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>{t('qn.template')}</span>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as TemplateId)}
            data-testid="qn-template"
          >
            <option value="CLASSIC">{t('qn.template.CLASSIC')}</option>
            <option value="QUICK">{t('qn.template.QUICK')}</option>
            <option value="BLANK">{t('qn.template.BLANK')}</option>
          </select>
        </label>
        <Button
          type="submit"
          size="md"
          block
          busy={busy}
          disabled={!title.trim()}
          data-testid="qn-create"
        >
          {t('qn.create')}
        </Button>
      </form>
      {nights && nights.length === 0 ? <p className={styles.muted}>{t('qn.empty')}</p> : null}
      {nights?.map((night) => (
        <div key={night.id} className={styles.nightRow} data-testid={`qn-night-${night.id}`}>
          <div>
            <strong>{night.title}</strong>
            <div className={styles.muted}>
              {night.date} ·{' '}
              {t('qn.summary', {
                rounds: night.rounds,
                questions: night.questions,
                teams: night.teams,
              })}
            </div>
          </div>
          <span className={styles[`status${night.status}`]}>{t(`qn.status.${night.status}`)}</span>
          <Button size="md" variant="violet" onClick={() => setOpenId(night.id)}>
            {t('qn.open')}
          </Button>
          {night.status !== 'LIVE' ? (
            <Button size="md" variant="ghost" onClick={() => void remove(night.id)}>
              {t('qn.delete')}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
