import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AccountApiError } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { DocumentAuthoring } from './DocumentAuthoring';
import { studioApi, type ManualAnswer, type ManualForm } from './displaysApi';
import staff from './StaffPage.module.css';

const EMPTY: ManualForm = {
  category: '',
  question: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  difficulty: 'MEDIUM',
  explanation: '',
  sourceUrl: '',
};
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;

/**
 * The "Soru Stüdyosu" tab (ADR-0028 §6), owner only: one question by hand. "Kontrol et" and "Kaydet" go
 * through the same checks as an uploaded file; the problems come back as codes and are shown in plain
 * words (`venue.issue.*`, the same texts as the file upload). Above the form, `DocumentAuthoring` turns a PDF,
 * Word or text file into drafts the owner reviews.
 */
export function QuestionStudio({ venueId }: { venueId: string }): ReactNode {
  const { t, td } = useI18n();
  const [form, setForm] = useState<ManualForm>(EMPTY);
  const [answer, setAnswer] = useState<ManualAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => {
    studioApi.categories(venueId).then(
      (result) => setLabels(result.categories.map((category) => category.label)),
      () => undefined,
    );
  }, [venueId]);

  const refusal = (cause: unknown): string => {
    if (cause instanceof AccountApiError) {
      if (cause.code === 'FORBIDDEN') return t('studio.error.owner');
      if (cause.code === 'RATE_LIMITED') return t('studio.error.throttled');
      if (cause.code === 'LIMIT_REACHED') return t('studio.error.limit');
    }
    return t('studio.error.generic');
  };

  const run = (mode: 'check' | 'save'): void => {
    setError(null);
    studioApi.manual(venueId, mode, form).then(
      (result) => {
        setAnswer(result);
        if (result.saved) setForm({ ...EMPTY, category: form.category });
      },
      (cause: unknown) => setError(refusal(cause)),
    );
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    run('save');
  };
  const set = <K extends keyof ManualForm>(key: K, value: ManualForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setAnswer(null);
  };

  return (
    <>
      <DocumentAuthoring venueId={venueId} />
      <form onSubmit={submit} data-testid="studio">
        <p className={staff.hint}>{t('studio.intro')}</p>
        <label className={staff.field}>
          {t('studio.category')}
          <input
            list="studio-categories"
            value={form.category}
            maxLength={80}
            onChange={(event) => set('category', event.target.value)}
            data-testid="studio-category"
          />
          <datalist id="studio-categories">
            {labels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </label>
        <label className={staff.field}>
          {t('studio.question')}
          <textarea
            value={form.question}
            rows={3}
            maxLength={600}
            onChange={(event) => set('question', event.target.value)}
            data-testid="studio-question"
          />
        </label>
        {form.options.map((option, index) => (
          <label key={index} className={staff.field}>
            {t('studio.option', { n: index + 1 })}
            <span className={staff.row}>
              <input
                type="radio"
                name="correct"
                checked={form.correctIndex === index}
                onChange={() => set('correctIndex', index)}
                aria-label={t('studio.correct')}
                data-testid={`studio-correct-${index}`}
              />
              <input
                value={option}
                maxLength={200}
                onChange={(event) =>
                  set(
                    'options',
                    form.options.map((current, at) =>
                      at === index ? event.target.value : current,
                    ),
                  )
                }
                data-testid={`studio-option-${index}`}
              />
            </span>
          </label>
        ))}
        <label className={staff.field}>
          {t('studio.difficulty')}
          <select
            value={form.difficulty}
            onChange={(event) => set('difficulty', event.target.value as ManualForm['difficulty'])}
          >
            {DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {td(`studio.difficulty.${level}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={staff.field}>
          {t('studio.explanation')}
          <textarea
            value={form.explanation}
            rows={2}
            maxLength={600}
            onChange={(event) => set('explanation', event.target.value)}
          />
        </label>
        <label className={staff.field}>
          {t('studio.source')}
          <input
            value={form.sourceUrl}
            maxLength={300}
            inputMode="url"
            onChange={(event) => set('sourceUrl', event.target.value)}
          />
        </label>
        <div className={staff.message} role="alert" data-testid="studio-error">
          {error ?? ''}
        </div>
        {answer ? (
          <div data-testid="studio-result" data-status={answer.status}>
            {answer.saved ? (
              <p className={staff.ok}>{t('studio.saved')}</p>
            ) : answer.status === 'OK' ? (
              <p className={staff.ok}>{t('studio.ok')}</p>
            ) : (
              <>
                <p className={staff.message}>{td(`studio.verdict.${answer.status}`)}</p>
                <p>{t('studio.problems')}</p>
                <ul>
                  {answer.issues.map((issue, index) => (
                    <li key={index}>
                      {td(`venue.issue.${issue.code}`, { field: issue.field, ...issue.params })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
        <div className={staff.row}>
          <Button type="button" size="lg" variant="ghost" onClick={() => run('check')}>
            {t('studio.check')}
          </Button>
          <Button type="submit" size="lg" data-testid="studio-save">
            {t('studio.save')}
          </Button>
        </div>
        <p className={staff.hint}>{t('studio.files')}</p>
      </form>
    </>
  );
}
