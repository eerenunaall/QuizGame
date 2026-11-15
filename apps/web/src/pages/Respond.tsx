import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { AccountApiError, accountApi, type RespondView } from '../lib/account';
import { useI18n } from '../lib/i18n';
import styles from './Quiz.module.css';

type Gone = 'dead' | 'claimed' | 'unavailable' | 'deleted';
type Prompt = RespondView['prompts'][number];

function PromptCard({
  token,
  prompt,
  name,
  language,
  suggest,
  onChange,
}: {
  token: string;
  prompt: Prompt;
  name: string;
  language: 'tr' | 'en';
  /** Server says the optional "suggest wrong answers" feature is on. */
  suggest: boolean;
  onChange: () => void;
}): ReactNode {
  const { t, td } = useI18n();
  const [answer, setAnswer] = useState(prompt.response?.answer ?? '');
  const [decoys, setDecoys] = useState<string[]>(
    [...(prompt.response?.decoys ?? []), ...Array<string>(3).fill('')].slice(0, 3),
  );
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const filled = decoys.filter((d) => d.trim() !== '');
  const saved = prompt.response;
  const approved = saved?.approved ?? false;

  const question =
    prompt.source === 'CATALOG' && prompt.catalogKey
      ? td(`blind.catalog.${prompt.catalogKey}.prompt`)
      : (prompt.text ?? '');

  const fail = (error: unknown): void => {
    const reason =
      error instanceof AccountApiError && typeof error.params.reason === 'string'
        ? error.params.reason
        : 'OTHER';
    const key = `respond.reason.${reason}`;
    setNote({ tone: 'bad', text: td(key) === key ? t('respond.reason.OTHER') : td(key) });
  };
  const save = (): void => {
    accountApi.respondPut(token, prompt.promptId, answer, filled).then(() => {
      setNote({ tone: 'ok', text: t('respond.saved') });
      onChange();
    }, fail);
  };
  // Optional help only: any failure or empty answer leaves the manual fields exactly as they were.
  const suggestDecoys = (): void => {
    accountApi.respondSuggest(token, prompt.promptId).then(
      (result) => {
        const fresh = result.decoys.filter((d) => !decoys.includes(d));
        if (fresh.length === 0) return;
        const next = [...decoys];
        for (const text of fresh) {
          const slot = next.findIndex((d) => d.trim() === '');
          if (slot < 0) break;
          next[slot] = text;
        }
        setDecoys(next);
        setNote({ tone: 'ok', text: t('respond.suggested') });
      },
      () => undefined,
    );
  };
  const approve = (value: boolean): void => {
    accountApi.respondApproval(token, prompt.promptId, value).then(onChange, (error: unknown) => {
      if (error instanceof AccountApiError && error.code === 'NOT_READY')
        setNote({ tone: 'bad', text: t('respond.needDecoy') });
      else fail(error);
    });
  };

  return (
    <section className={styles.prompt} data-testid={`prompt-${prompt.position}`}>
      <h2>{question}</h2>
      <label>
        {t('respond.answer')}
        <input
          value={answer}
          maxLength={140}
          onChange={(event) => setAnswer(event.target.value)}
          data-testid={`answer-${prompt.position}`}
        />
      </label>
      <p className={styles.fine}>{t('respond.decoys')}</p>
      {decoys.map((decoy, index) => (
        <input
          key={index}
          value={decoy}
          maxLength={140}
          placeholder={t('respond.decoy', { n: index + 1 })}
          onChange={(event) =>
            setDecoys(decoys.map((d, i) => (i === index ? event.target.value : d)))
          }
          data-testid={`decoy-${prompt.position}-${index}`}
        />
      ))}
      {suggest && saved ? (
        <Button
          variant="ghost"
          size="md"
          onClick={suggestDecoys}
          data-testid={`suggest-${prompt.position}`}
        >
          {t('respond.suggest')}
        </Button>
      ) : null}
      {note ? (
        <p
          role={note.tone === 'bad' ? 'alert' : 'status'}
          className={note.tone === 'bad' ? styles.warn : styles.ok}
        >
          {note.text}
        </p>
      ) : null}
      <Button
        size="md"
        onClick={save}
        disabled={answer.trim() === ''}
        data-testid={`save-${prompt.position}`}
      >
        {t('respond.save')}
      </Button>
      {saved ? (
        <div className={styles.preview} data-testid={`preview-${prompt.position}`}>
          <p className={styles.fine}>{t('respond.preview')}</p>
          <strong>
            {prompt.source === 'CATALOG' && prompt.catalogKey
              ? td(`blind.catalog.${prompt.catalogKey}.question`, { name })
              : td('blind.question.custom', { name, prompt: prompt.text ?? '' })}
          </strong>
          <ul>
            {[saved.answer, ...saved.decoys].map((option, index) => (
              <li key={index}>{option}</li>
            ))}
          </ul>
          <span hidden>{language}</span>
          {approved ? (
            <Button variant="ghost" size="md" onClick={() => approve(false)}>
              {t('respond.unapprove')}
            </Button>
          ) : (
            <Button
              variant="success"
              size="md"
              onClick={() => approve(true)}
              data-testid={`approve-${prompt.position}`}
            >
              {t('respond.approve')}
            </Button>
          )}
          {approved ? <span className={styles.ok}> ✓ {t('respond.approved')}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/** What the person being quizzed sees: consent first, then each question with a private preview and approval. */
export function RespondPage({ token }: { token: string }): ReactNode {
  const { t } = useI18n();
  const [view, setView] = useState<RespondView | Gone | null>(null);

  const load = useCallback(() => {
    accountApi.respondView(token).then(setView, (error: unknown) => {
      // 403: another browser consented first and owns the invite. 404: unknown, replaced, expired
      // or deleted (the server answers all alike on purpose). Anything else is a hiccup.
      if (error instanceof AccountApiError && error.status === 403) setView('claimed');
      else if (error instanceof AccountApiError && error.status === 404) setView('dead');
      else setView('unavailable');
    });
  }, [token]);
  useEffect(load, [load]);

  if (view === null) return <div className={styles.page} />;
  if (typeof view === 'string')
    return (
      <div className={styles.page}>
        <Wordmark scale={0.5} />
        <main className={styles.card} data-testid={`respond-${view}`}>
          <p role={view === 'deleted' ? 'status' : 'alert'}>{t(`respond.${view}`)}</p>
          {view === 'unavailable' ? (
            <Button size="md" onClick={load} data-testid="respond-retry">
              {t('respond.retry')}
            </Button>
          ) : null}
        </main>
      </div>
    );

  return (
    <div className={styles.page}>
      <Wordmark scale={0.5} />
      <main className={styles.card} data-testid="respond-page">
        <h1>{t('respond.title')}</h1>
        {!view.target.consented ? (
          <section data-testid="respond-consent">
            <h2>{t('respond.consent.title')}</h2>
            <ul>
              <li>{t('respond.consent.one')}</li>
              <li>{t('respond.consent.two')}</li>
              <li>{t('respond.consent.three')}</li>
              <li>{t('respond.consent.four')}</li>
            </ul>
            <Button
              size="lg"
              block
              onClick={() => void accountApi.respondConsent(token).then(load)}
              data-testid="respond-agree"
            >
              {t('respond.consent.agree')}
            </Button>
          </section>
        ) : (
          <>
            {view.prompts.map((prompt) => (
              <PromptCard
                key={prompt.promptId}
                token={token}
                prompt={prompt}
                name={view.target.name}
                language={view.quiz.language}
                suggest={view.features?.suggestDecoys === true}
                onChange={load}
              />
            ))}
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                if (window.confirm(t('respond.delete.confirm')))
                  void accountApi.respondDelete(token).then(() => setView('deleted'));
              }}
              data-testid="respond-delete"
            >
              {t('respond.delete')}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
