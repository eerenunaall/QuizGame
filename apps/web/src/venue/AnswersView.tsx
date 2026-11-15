import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import {
  bankApi,
  type BankCategory,
  type BankPage,
  type BankQuestion,
  type BankScope,
} from './bankApi';
import styles from './AnswersView.module.css';
import staff from './StaffPage.module.css';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * The owner's "Cevap anahtarı" (ADR-0030 §5): the venue's own questions or the general bank, each card with
 * every option and the correct one marked, the explanation, the status and the difficulty. Question text
 * is always a text node: React escapes it, nothing here sets HTML. Typing waits 350 ms before asking, and
 * the wait is cancelled when the view closes.
 */
export function AnswersView({ venueId, scope }: { venueId: string; scope: BankScope }): ReactNode {
  const { t } = useI18n();
  const [language, setLanguage] = useState<'tr' | 'en'>('tr');
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<BankCategory[]>([]);
  const [items, setItems] = useState<BankQuestion[]>([]);
  const [page, setPage] = useState<Pick<BankPage, 'total' | 'hasMore'> | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  // The scope or language changed: the topic list is that of the new pool.
  useEffect(() => {
    let live = true;
    setCategory('');
    bankApi.categories(venueId, scope, language).then(
      (result) => {
        if (live) setCategories(result.categories);
      },
      () => {
        if (live) setCategories([]);
      },
    );
    return () => {
      live = false;
    };
  }, [venueId, scope, language]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(
    (offset: number): void => {
      const mine = ++request.current;
      setBusy(true);
      setFailed(false);
      bankApi.questions(venueId, { scope, language, q: search, category, offset }).then(
        (result) => {
          if (mine !== request.current) return;
          setItems((current) => (offset === 0 ? result.items : [...current, ...result.items]));
          setPage({ total: result.total, hasMore: result.hasMore });
          setBusy(false);
        },
        () => {
          if (mine !== request.current) return;
          setFailed(true);
          setBusy(false);
        },
      );
    },
    [venueId, scope, language, search, category],
  );

  useEffect(() => {
    setItems([]);
    load(0);
  }, [load]);

  return (
    <section className={styles.view} data-testid={`answers-${scope.toLowerCase()}`}>
      <p className={staff.intro}>
        {scope === 'VENUE' ? t('panel.answers.intro.venue') : t('panel.answers.intro.bank')}
      </p>
      <label className={staff.field}>
        {t('panel.answers.search')}
        <input
          type="search"
          maxLength={60}
          placeholder={t('panel.answers.searchHint')}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          data-testid="answers-search"
        />
      </label>
      <div className={staff.grid}>
        <label className={staff.field}>
          {t('panel.answers.category')}
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            data-testid="answers-category"
          >
            <option value="">{t('panel.answers.categoryAll')}</option>
            {categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({entry.count})
              </option>
            ))}
          </select>
        </label>
        <label className={staff.field}>
          {t('panel.answers.language')}
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'tr')}
            data-testid="answers-language"
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      {page ? (
        <p className={staff.hint} data-testid="answers-total">
          {t('panel.answers.total', { n: page.total })}
        </p>
      ) : null}
      {failed ? (
        <p className={staff.fieldError} role="alert">
          {t('panel.answers.error')}
        </p>
      ) : null}
      {page && items.length === 0 && !busy && !failed ? (
        <p className={staff.hint} data-testid="answers-empty">
          {t('panel.answers.empty')}
        </p>
      ) : null}
      <ol className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={styles.card} data-testid="answer-card">
            <div className={styles.meta}>
              <span className={styles.badge}>{item.category}</span>
              <span className={styles.badge}>{difficulty(t, item.difficulty)}</span>
              <span className={item.status === 'ACTIVE' ? styles.badgeOn : styles.badge}>
                {status(t, item.status)}
              </span>
            </div>
            <p className={styles.question}>{item.text}</p>
            <ul className={styles.options}>
              {item.options.map((option, index) => (
                <li
                  key={index}
                  className={option.correct ? styles.optionRight : styles.option}
                  data-correct={option.correct ? '1' : '0'}
                >
                  <span className={styles.letter}>{LETTERS[index] ?? index + 1}</span>
                  <span className={styles.optionText}>{option.text}</span>
                  {option.correct ? (
                    <span className={styles.tick}>
                      <span aria-hidden="true">✓</span>
                      <span className={styles.srOnly}>{t('panel.answers.correct')}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {item.explanation ? (
              <p className={styles.explanation}>
                <strong>{t('panel.answers.explanation')}: </strong>
                {item.explanation}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {page?.hasMore ? (
        <button
          type="button"
          className={staff.smallButton}
          disabled={busy}
          onClick={() => load(items.length)}
          data-testid="answers-more"
        >
          {t('panel.answers.more')}
        </button>
      ) : null}
    </section>
  );
}

function difficulty(t: ReturnType<typeof useI18n>['t'], value: string): string {
  switch (value) {
    case 'EASY':
      return t('panel.answers.difficulty.EASY');
    case 'MEDIUM':
      return t('panel.answers.difficulty.MEDIUM');
    case 'HARD':
      return t('panel.answers.difficulty.HARD');
    case 'EXPERT':
      return t('panel.answers.difficulty.EXPERT');
    default:
      return value;
  }
}

function status(t: ReturnType<typeof useI18n>['t'], value: string): string {
  switch (value) {
    case 'ACTIVE':
      return t('panel.answers.status.ACTIVE');
    case 'REVIEW':
      return t('panel.answers.status.REVIEW');
    case 'RETIRED':
      return t('panel.answers.status.RETIRED');
    default:
      return value;
  }
}
