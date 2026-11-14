import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AccountApiError } from '../lib/account';
import { useI18n } from '../lib/i18n';
import {
  authoringApi,
  type AuthoringRun,
  type AuthoringState,
  type DraftIssue,
  type DraftItem,
} from './displaysApi';
import styles from './DocumentAuthoring.module.css';
import staff from './StaffPage.module.css';

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;
const POLL_MS = 2000;
/** A tiny, genuine document the owner can try the feature with (no personal data, a few plain facts). */
const EXAMPLE_TEXT = [
  'Galata Kulesi',
  '',
  "Galata Kulesi, İstanbul'un en bilinen simgelerinden biridir ve 1348 yılında Cenevizliler tarafından inşa edilmiştir.",
  "Kule, Haliç'in kuzeyinde yer alır ve yüzyıllar boyunca gözetleme kulesi olarak kullanılmıştır.",
  'Kulenin yüksekliği yaklaşık 67 metredir ve tepesinden şehrin panoramik manzarası görülebilir.',
  '',
  'Tarihçesi',
  '',
  "Osmanlı döneminde kule yangın gözetleme kulesi olarak görev yapmış, 1960'larda onarılarak müzeye dönüştürülmüştür.",
  "Hezarfen Ahmed Çelebi'nin kuleden uçtuğu rivayet edilir ve bu hikâye şehir efsanelerinin en meşhurlarındandır.",
  'Bugün kule her yıl yüz binlerce ziyaretçiyi ağırlar ve İstanbul turizminin en önemli duraklarından biridir.',
].join('\n');

/**
 * "Belgeden soru üret" (ADR-0028 §6), part of the Soru Stüdyosu. The owner picks a file; the server reads it,
 * asks the model and stores DRAFTS. Nothing here publishes anything by itself: a question reaches the venue
 * pool only through the per-card "Onayla" or "Hepsini onayla", which the server runs through the same
 * checks as any upload. Every message is plain Turkish; the server only sends codes.
 */
export function DocumentAuthoring({
  venueId,
  pollMs = POLL_MS,
}: {
  venueId: string;
  /** Tests poll fast; the page asks every two seconds. */
  pollMs?: number;
}): ReactNode {
  const { t, td } = useI18n();
  const [state, setState] = useState<AuthoringState | null | 'error'>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('Belgeden sorular');
  const [run, setRun] = useState<AuthoringRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, DraftIssue[]>>({});
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const refuse = useCallback(
    (cause: unknown): string => {
      if (cause instanceof AccountApiError) {
        const reason = cause.params.reason;
        if (cause.code === 'FEATURE_DISABLED') return t('studio.ai.error.off');
        if (typeof reason === 'string' && cause.code !== 'FORBIDDEN')
          return td(`studio.ai.error.${reason}`);
        if (cause.code === 'RATE_LIMITED') return t('studio.error.throttled');
        if (cause.code === 'FORBIDDEN') return t('studio.error.owner');
        if (cause.code === 'LIMIT_REACHED') return t('studio.error.limit');
      }
      return t('studio.error.generic');
    },
    [t, td],
  );

  const loadDrafts = useCallback(async (): Promise<void> => {
    try {
      const list = await authoringApi.drafts(venueId);
      if (alive.current) setDrafts(list.items);
    } catch {
      /* the list stays as it was; the next action shows the problem */
    }
  }, [venueId]);
  const loadState = useCallback(async (): Promise<void> => {
    try {
      const next = await authoringApi.state(venueId);
      if (alive.current) setState(next);
    } catch {
      if (alive.current) setState('error');
    }
  }, [venueId]);

  useEffect(() => {
    alive.current = true;
    void loadState();
    void loadDrafts();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [loadState, loadDrafts]);

  const poll = useCallback(
    (runId: string, startedAt: number): void => {
      timer.current = setTimeout(() => {
        authoringApi.run(venueId, runId).then(
          (next) => {
            if (!alive.current) return;
            setElapsed(Math.round((Date.now() - startedAt) / 1000));
            setRun(next);
            if (next.status === 'RUNNING') poll(runId, startedAt);
            else {
              setBusy(false);
              void loadDrafts();
              void loadState();
            }
          },
          (cause: unknown) => {
            if (!alive.current) return;
            setBusy(false);
            setError(refuse(cause));
          },
        );
      }, pollMs);
    },
    [venueId, loadDrafts, loadState, refuse, pollMs],
  );

  const start = (): void => {
    if (!file) return;
    setError(null);
    setNotice(null);
    setRun(null);
    setBusy(true);
    setElapsed(0);
    authoringApi.start(venueId, file, category.trim() || 'Belgeden sorular').then(
      ({ runId }) => {
        setRun({
          id: runId,
          status: 'RUNNING',
          failure: null,
          fileName: file.name,
          drafts: 0,
          discarded: 0,
        });
        poll(runId, Date.now());
      },
      (cause: unknown) => {
        setBusy(false);
        setError(refuse(cause));
      },
    );
  };

  const approve = (which: string[] | 'all'): void => {
    setError(null);
    setNotice(null);
    authoringApi.approve(venueId, which).then(
      (result) => {
        const left: Record<string, DraftIssue[]> = {};
        for (const item of result.problems) left[item.id] = item.issues;
        setProblems(left);
        setNotice(
          result.problems.length > 0
            ? `${t('studio.ai.approved', { n: result.approved })} ${t('studio.ai.notApproved', { n: result.problems.length })}`
            : t('studio.ai.approved', { n: result.approved }),
        );
        void loadDrafts();
      },
      (cause: unknown) => setError(refuse(cause)),
    );
  };
  const remove = (id: string): void => {
    authoringApi.remove(venueId, id).then(
      () => void loadDrafts(),
      (cause: unknown) => setError(refuse(cause)),
    );
  };
  const saved = (item: DraftItem, issues: DraftIssue[]): void => {
    setDrafts((current) => current.map((draft) => (draft.id === item.id ? item : draft)));
    setProblems((current) => ({ ...current, [item.id]: issues }));
  };

  const exampleHref = `data:text/plain;charset=utf-8,${encodeURIComponent(EXAMPLE_TEXT)}`;
  const enabled = state !== null && state !== 'error' && state.enabled;
  const quota = state !== null && state !== 'error' ? state.quota : null;
  const used = quota !== null && quota.used >= quota.limit;

  return (
    <section className={styles.box} data-testid="authoring">
      <h3 className={staff.sectionTitle}>{t('studio.ai.title')}</h3>
      <p className={staff.hint}>{t('studio.ai.intro')}</p>
      <p className={staff.hint}>
        {t('studio.ai.tip')}{' '}
        <a href={exampleHref} download="ornek-belge.txt" data-testid="authoring-example">
          {t('studio.ai.example')}
        </a>
      </p>

      {state !== null && !enabled ? (
        <p className={staff.message} data-testid="authoring-off">
          {t('studio.ai.off')}
        </p>
      ) : (
        <>
          <label className={staff.field}>
            {t('studio.ai.category')}
            <input
              value={category}
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
              data-testid="authoring-category"
            />
          </label>
          <div className={styles.pick}>
            <label className={styles.fileButton}>
              {t('studio.ai.pick')}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                className={styles.fileInput}
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                data-testid="authoring-file"
              />
            </label>
            <span className={staff.hint} data-testid="authoring-chosen">
              {file ? t('studio.ai.chosen', { name: file.name }) : t('studio.ai.none')}
            </span>
          </div>
          {quota ? (
            <p className={staff.hint} data-testid="authoring-quota">
              {t('studio.ai.quota', { used: quota.used, limit: quota.limit })}
            </p>
          ) : null}
          <Button
            size="lg"
            block
            disabled={!file || busy || !enabled || used}
            busy={busy}
            onClick={start}
            data-testid="authoring-start"
          >
            {t('studio.ai.start')}
          </Button>
        </>
      )}

      {busy ? (
        <div className={styles.progress} data-testid="authoring-progress">
          <progress aria-label={t('studio.ai.working')} />
          <p>{t('studio.ai.working')}</p>
          <p className={staff.hint}>{t('studio.ai.elapsed', { s: elapsed })}</p>
        </div>
      ) : null}
      <div className={staff.message} role="alert" data-testid="authoring-error">
        {error ??
          (run?.status === 'FAILED' && run.failure ? td(`studio.ai.fail.${run.failure}`) : '')}
      </div>
      {run?.status === 'EMPTY' ? (
        <p className={staff.message} data-testid="authoring-empty">
          {t('studio.ai.empty')}
        </p>
      ) : null}
      {run?.status === 'OK' ? (
        <p className={staff.ok} data-testid="authoring-done">
          {run.discarded > 0
            ? t('studio.ai.doneDropped', { n: run.drafts, dropped: run.discarded })
            : t('studio.ai.done', { n: run.drafts })}
        </p>
      ) : null}

      <h3 className={staff.sectionTitle} data-testid="authoring-drafts-title">
        {t('studio.ai.drafts', { n: drafts.length })}
      </h3>
      <p className={staff.hint}>{t('studio.ai.draftsNote')}</p>
      {notice ? (
        <p className={staff.ok} role="status" data-testid="authoring-notice">
          {notice}
        </p>
      ) : null}
      {drafts.length === 0 ? (
        <p className={staff.hint} data-testid="authoring-nodrafts">
          {t('studio.ai.noDrafts')}
        </p>
      ) : (
        <>
          <Button
            size="xl"
            variant="success"
            block
            onClick={() => {
              if (window.confirm(t('studio.ai.confirmAll', { n: drafts.length }))) approve('all');
            }}
            data-testid="authoring-approve-all"
          >
            {t('studio.ai.approveAll')}
          </Button>
          <ul className={styles.list}>
            {drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                venueId={venueId}
                draft={draft}
                issues={problems[draft.id] ?? []}
                onApprove={() => approve([draft.id])}
                onDelete={() => remove(draft.id)}
                onSaved={saved}
                onError={(cause) => setError(refuse(cause))}
                difficultyLabel={(level) => td(`studio.difficulty.${level}`)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DraftCard(props: {
  venueId: string;
  draft: DraftItem;
  issues: DraftIssue[];
  onApprove: () => void;
  onDelete: () => void;
  onSaved: (draft: DraftItem, issues: DraftIssue[]) => void;
  onError: (cause: unknown) => void;
  difficultyLabel: (level: string) => string;
}): ReactNode {
  const { t, td } = useI18n();
  const { draft } = props;
  const p = draft.payload;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    category: p.category,
    difficulty: p.difficulty,
    question: p.question,
    options: p.options,
    correctIndex: p.correctIndex,
    explanation: p.explanation,
  }));

  const save = (): void => {
    authoringApi.edit(props.venueId, draft.id, form).then((result) => {
      props.onSaved(result.draft, result.issues);
      setEditing(false);
    }, props.onError);
  };

  return (
    <li className={styles.card} data-testid="draft-card" data-id={draft.id}>
      {editing ? (
        <div data-testid="draft-edit">
          <label className={staff.field}>
            {t('studio.question')}
            <textarea
              rows={3}
              maxLength={600}
              value={form.question}
              onChange={(event) => setForm({ ...form, question: event.target.value })}
              data-testid="draft-edit-question"
            />
          </label>
          {form.options.map((option, index) => (
            <label key={index} className={staff.field}>
              {t('studio.option', { n: index + 1 })}
              <span className={staff.row}>
                <input
                  type="radio"
                  name={`correct-${draft.id}`}
                  checked={form.correctIndex === index}
                  onChange={() => setForm({ ...form, correctIndex: index })}
                  aria-label={t('studio.correct')}
                />
                <input
                  value={option}
                  maxLength={200}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      options: form.options.map((o, at) => (at === index ? event.target.value : o)),
                    })
                  }
                  data-testid={`draft-edit-option-${index}`}
                />
              </span>
            </label>
          ))}
          <label className={staff.field}>
            {t('studio.difficulty')}
            <select
              value={form.difficulty}
              onChange={(event) =>
                setForm({
                  ...form,
                  difficulty: event.target.value as (typeof DIFFICULTIES)[number],
                })
              }
            >
              {DIFFICULTIES.map((level) => (
                <option key={level} value={level}>
                  {props.difficultyLabel(level)}
                </option>
              ))}
            </select>
          </label>
          <label className={staff.field}>
            {t('studio.ai.explanation')}
            <textarea
              rows={2}
              maxLength={600}
              value={form.explanation}
              onChange={(event) => setForm({ ...form, explanation: event.target.value })}
            />
          </label>
          <div className={staff.row}>
            <Button size="lg" onClick={save} data-testid="draft-edit-save">
              {t('studio.ai.save')}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setEditing(false)}>
              {t('studio.ai.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.question} data-testid="draft-question">
            {p.question}
          </p>
          <ol className={styles.options} type="A">
            {p.options.map((option, index) => (
              <li
                key={index}
                className={index === p.correctIndex ? styles.correct : undefined}
                data-correct={index === p.correctIndex}
              >
                {option}
                {index === p.correctIndex ? (
                  <strong className={styles.badge}> ✓ {t('studio.ai.correctMark')}</strong>
                ) : null}
              </li>
            ))}
          </ol>
          <p className={styles.meta}>
            {props.difficultyLabel(p.difficulty)} · {p.category}
          </p>
          <p className={styles.explain}>
            <strong>{t('studio.ai.explanation')}</strong> {p.explanation}
          </p>
          <blockquote className={styles.quote} data-testid="draft-quote">
            <span className={styles.quoteLabel}>
              {t('studio.ai.quote')} ({t('studio.ai.where', { where: p.page })})
            </span>
            “{p.sourceQuote}”
          </blockquote>
          {props.issues.length > 0 ? (
            <div className={staff.message} data-testid="draft-issues">
              <p>{t('studio.ai.fixThese')}</p>
              <ul>
                {props.issues.map((issue, index) => (
                  <li key={index}>
                    {td(`venue.issue.${issue.code}`, { field: issue.field, ...issue.params })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={styles.actions}>
            <Button
              size="lg"
              variant="success"
              onClick={props.onApprove}
              data-testid="draft-approve"
            >
              {t('studio.ai.approve')}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => setEditing(true)}
              data-testid="draft-edit-open"
            >
              {t('studio.ai.edit')}
            </Button>
            <Button size="lg" variant="danger" onClick={props.onDelete} data-testid="draft-delete">
              {t('studio.ai.delete')}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
