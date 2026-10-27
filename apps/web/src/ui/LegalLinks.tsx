import { LEGAL_PATHS, legalLinks } from '@quizparty/i18n/legal-links';
import { Link } from '../lib/router';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';
import styles from './LegalLinks.module.css';

/** Privacy · Terms · Support, on the title, join and legal pages (store and KVKK need them reachable). */
export function LegalLinks({ className, size = 'sm' }: { className?: string; size?: 'sm' | 'tv' }) {
  const { locale } = useI18n();
  const labels = legalLinks[locale];
  return (
    <nav
      className={cx(styles.links, size === 'tv' && styles.tv, className)}
      data-testid="legal-links"
    >
      {(Object.keys(LEGAL_PATHS) as (keyof typeof LEGAL_PATHS)[]).map((id) => (
        <Link key={id} to={LEGAL_PATHS[id]} className={styles.link}>
          {labels[id]}
        </Link>
      ))}
    </nav>
  );
}
