import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { accountApi, type QuizKind, type QuizSummary } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { Link, useNavigate } from '../lib/router';
import styles from './Quiz.module.css';
import { SignInForm, useAccount } from './useAccount';

/** The creator's front door: sign in, list personal quizzes, start a new one. */
export function QuizzesPage(): ReactNode {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { state, signedIn, signOut } = useAccount();
  const [items, setItems] = useState<QuizSummary[] | null>(null);
  const [kind, setKind] = useState<QuizKind>('BLIND');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    accountApi.quizzes().then(
      (result) => setItems(result.items),
      () => setItems([]),
    );
  }, []);
  useEffect(() => {
    if (state.kind === 'in') load();
  }, [state, load]);

  const create = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    accountApi.createQuiz(kind, title, locale).then(
      (quiz) => navigate(`/quizzes/${quiz.id}`),
      () => setError(t('error.TEXT_REJECTED')),
    );
  };

  return (
    <div className={styles.page}>
      <Wordmark scale={0.5} />
      <main className={styles.card} data-testid="quizzes-page">
        <h1>{t('quiz.nav.title')}</h1>
        {state.kind === 'out' ? (
          <SignInForm intro={t('quiz.signInIntro')} onSignedIn={signedIn} />
        ) : null}
        {state.kind === 'in' ? (
          <>
            {items && items.length === 0 ? <p>{t('quiz.list.empty')}</p> : null}
            <ul className={styles.list} data-testid="quiz-list">
              {(items ?? []).map((quiz) => (
                <li key={quiz.id}>
                  <Link to={`/quizzes/${quiz.id}`}>{quiz.title}</Link>{' '}
                  <span className={styles.badge}>{t(`quiz.kind.${quiz.kind}`)}</span>{' '}
                  <span className={quiz.ready ? styles.ok : styles.warn}>
                    {quiz.ready ? t('quiz.ready') : t('quiz.notReady')}
                  </span>
                </li>
              ))}
            </ul>
            <form onSubmit={create} className={styles.form}>
              <h2>{t('quiz.new.title')}</h2>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as QuizKind)}
                data-testid="quiz-kind"
              >
                <option value="BLIND">{t('quiz.new.kind.BLIND')}</option>
                <option value="CUSTOM">{t('quiz.new.kind.CUSTOM')}</option>
              </select>
              <input
                value={title}
                maxLength={60}
                placeholder={t('quiz.new.name')}
                onChange={(event) => setTitle(event.target.value)}
                data-testid="quiz-title"
              />
              {error ? <p role="alert">{error}</p> : null}
              <Button
                type="submit"
                size="md"
                block
                disabled={title.trim().length === 0}
                data-testid="quiz-create"
              >
                {t('quiz.new.create')}
              </Button>
            </form>
            <Button variant="ghost" size="md" block onClick={signOut}>
              {t('unlock.signOut')}
            </Button>
          </>
        ) : null}
      </main>
    </div>
  );
}
