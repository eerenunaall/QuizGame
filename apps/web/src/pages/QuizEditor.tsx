import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BLIND_CATALOG_KEYS } from '@quizparty/protocol';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { AccountApiError, accountApi, type QuizDetail } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { Link, useNavigate } from '../lib/router';
import styles from './Quiz.module.css';
import { SignInForm, useAccount } from './useAccount';

function Invite({ url, onDone }: { url: string; onDone: () => void }): ReactNode {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.invite} data-testid="invite-link">
      <p>{t('quiz.targets.link')}</p>
      <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
      <Button
        size="md"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        {copied ? t('quiz.targets.copied') : t('quiz.targets.copy')}
      </Button>{' '}
      <Button variant="ghost" size="md" onClick={onDone}>
        {t('common.close')}
      </Button>
    </div>
  );
}

/** One quiz: for a Blind Quiz its questions and the people to invite (status only, never answers); for a Custom Quiz its questions. */
export function QuizEditorPage({ id }: { id: string }): ReactNode {
  const { t, td, locale } = useI18n();
  const navigate = useNavigate();
  const { state, signedIn } = useAccount();
  const [quiz, setQuiz] = useState<QuizDetail | null | 'missing'>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [targetName, setTargetName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState({ text: '', options: ['', '', '', ''], correct: 0, explanation: '' });

  const load = useCallback(() => {
    accountApi.quiz(id).then(setQuiz, () => setQuiz('missing'));
  }, [id]);
  useEffect(() => {
    if (state.kind === 'in') load();
  }, [state, load]);

  const act = (work: () => Promise<unknown>): void => {
    setError(null);
    work().then(load, () => setError(t('error.TEXT_REJECTED')));
  };

  const date = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-GB');

  if (state.kind === 'out')
    return (
      <div className={styles.page}>
        <main className={styles.card}>
          <SignInForm intro={t('quiz.signInIntro')} onSignedIn={signedIn} />
        </main>
      </div>
    );
  if (quiz === 'missing')
    return (
      <div className={styles.page}>
        <main className={styles.card}>
          <p role="alert">{t('error.ROOM_NOT_FOUND')}</p>
          <Link to="/quizzes">{t('quiz.back')}</Link>
        </main>
      </div>
    );
  if (!quiz) return <div className={styles.page} />;
  const usedKeys = new Set(quiz.prompts.map((p) => p.catalogKey));

  return (
    <div className={styles.page}>
      <Wordmark scale={0.4} />
      <main className={styles.card} data-testid="quiz-editor">
        <p>
          <Link to="/quizzes">{t('quiz.back')}</Link>
        </p>
        <h1>{quiz.title}</h1>
        <p>
          <span className={styles.badge}>{t(`quiz.kind.${quiz.kind}`)}</span>{' '}
          <span className={quiz.ready ? styles.ok : styles.warn}>
            {quiz.ready ? t('quiz.ready') : t('quiz.notReady')}
          </span>
        </p>
        <p className={styles.fine}>{t('quiz.use')}</p>
        {error ? (
          <p role="alert" data-testid="quiz-error">
            {error}
          </p>
        ) : null}

        {quiz.kind === 'BLIND' ? (
          <>
            <p>{t('quiz.blind.how')}</p>
            <h2>{t('quiz.prompts.title')}</h2>
            <ul className={styles.list} data-testid="prompt-list">
              {quiz.prompts.map((p) => (
                <li key={p.id}>
                  {p.catalogKey ? td(`blind.catalog.${p.catalogKey}.prompt`) : p.text}{' '}
                  <button
                    type="button"
                    onClick={() => act(() => accountApi.removePrompt(id, p.id))}
                  >
                    {t('quiz.prompts.remove')}
                  </button>
                </li>
              ))}
            </ul>
            <h3>{t('quiz.prompts.catalog')}</h3>
            <div className={styles.chips}>
              {BLIND_CATALOG_KEYS.filter((key) => !usedKeys.has(key)).map((key) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`catalog-${key}`}
                  onClick={() => act(() => accountApi.addPrompt(id, { catalogKey: key }))}
                >
                  + {td(`blind.catalog.${key}.prompt`)}
                </button>
              ))}
            </div>
            <form
              className={styles.form}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                act(() => accountApi.addPrompt(id, { text: prompt }).then(() => setPrompt('')));
              }}
            >
              <h3>{t('quiz.prompts.custom')}</h3>
              <input
                value={prompt}
                maxLength={140}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <Button type="submit" size="md" disabled={prompt.trim().length < 3}>
                {t('quiz.prompts.add')}
              </Button>
            </form>

            <h2>{t('quiz.targets.title')}</h2>
            {invite ? <Invite url={invite} onDone={() => setInvite(null)} /> : null}
            <ul className={styles.list} data-testid="target-list">
              {quiz.targets.map((target) => (
                <li key={target.id}>
                  <strong>{target.displayName}</strong>{' '}
                  <span className={target.status === 'APPROVED' ? styles.ok : styles.warn}>
                    {t(`quiz.status.${target.status}`)}
                  </span>{' '}
                  <span className={styles.fine}>
                    {t('quiz.targets.progress', { approved: target.approved, total: target.total })}
                  </span>{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      accountApi.rotateInvite(id, target.id).then(
                        (r) => setInvite(r.inviteUrl),
                        (failure: unknown) =>
                          // 409: the target already claimed the invite (ADR-0015 addendum).
                          setError(
                            failure instanceof AccountApiError && failure.status === 409
                              ? t('quiz.targets.rotateRefused', { name: target.displayName })
                              : t('error.TEXT_REJECTED'),
                          ),
                      );
                    }}
                  >
                    {t('quiz.targets.rotate')}
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() => act(() => accountApi.removeTarget(id, target.id))}
                  >
                    {t('quiz.targets.remove')}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className={styles.form}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                setError(null);
                accountApi.addTarget(id, targetName).then(
                  (result) => {
                    setInvite(result.inviteUrl);
                    setTargetName('');
                    load();
                  },
                  () => setError(t('error.TEXT_REJECTED')),
                );
              }}
            >
              <input
                value={targetName}
                maxLength={30}
                placeholder={t('quiz.targets.name')}
                onChange={(event) => setTargetName(event.target.value)}
                data-testid="target-name"
              />
              <Button
                type="submit"
                size="md"
                disabled={targetName.trim().length === 0}
                data-testid="target-add"
              >
                {t('quiz.targets.add')}
              </Button>
            </form>
          </>
        ) : (
          <>
            <h2>{t('quiz.custom.title')}</h2>
            <ol className={styles.list} data-testid="question-list">
              {quiz.questions.map((question) => (
                <li key={question.id}>
                  {question.text}{' '}
                  <span className={styles.fine}>
                    {question.options
                      .map((o, i) => (i === question.correctIndex ? `✓ ${o}` : o))
                      .join(' · ')}
                  </span>{' '}
                  <button
                    type="button"
                    onClick={() => act(() => accountApi.removeQuestion(id, question.id))}
                  >
                    {t('quiz.prompts.remove')}
                  </button>
                </li>
              ))}
            </ol>
            <form
              className={styles.form}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const options = q.options.filter((o) => o.trim() !== '');
                const correctText = q.options[q.correct] ?? '';
                act(() =>
                  accountApi
                    .addQuestion(id, {
                      text: q.text,
                      options,
                      correctIndex: Math.max(0, options.indexOf(correctText)),
                      ...(q.explanation ? { explanation: q.explanation } : {}),
                    })
                    .then(() =>
                      setQ({ text: '', options: ['', '', '', ''], correct: 0, explanation: '' }),
                    ),
                );
              }}
            >
              <input
                value={q.text}
                maxLength={200}
                placeholder={t('quiz.custom.text')}
                onChange={(event) => setQ({ ...q, text: event.target.value })}
                data-testid="question-text"
              />
              {q.options.map((option, index) => (
                <div key={index} className={styles.optionRow}>
                  <input
                    type="radio"
                    name="correct"
                    checked={q.correct === index}
                    aria-label={t('quiz.custom.correct')}
                    onChange={() => setQ({ ...q, correct: index })}
                  />
                  <input
                    value={option}
                    maxLength={80}
                    placeholder={t('quiz.custom.option', { n: index + 1 })}
                    onChange={(event) =>
                      setQ({
                        ...q,
                        options: q.options.map((o, i) => (i === index ? event.target.value : o)),
                      })
                    }
                    data-testid={`question-option-${index}`}
                  />
                </div>
              ))}
              <input
                value={q.explanation}
                maxLength={200}
                placeholder={t('quiz.custom.explanation')}
                onChange={(event) => setQ({ ...q, explanation: event.target.value })}
              />
              <Button type="submit" size="md" data-testid="question-add">
                {t('quiz.custom.add')}
              </Button>
            </form>
          </>
        )}

        <p className={styles.fine}>{t('quiz.retention', { date: date(quiz.retainUntil) })}</p>
        <Button
          variant="danger"
          size="md"
          onClick={() => {
            if (window.confirm(t('quiz.delete.confirm')))
              void accountApi.deleteQuiz(id).then(() => navigate('/quizzes'));
          }}
          data-testid="quiz-delete"
        >
          {t('quiz.delete')}
        </Button>
      </main>
    </div>
  );
}
