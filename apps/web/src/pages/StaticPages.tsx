import { Link } from '../lib/router';
import { ASSET_CREDITS } from '../assets/credits.generated';
import { useI18n } from '../lib/i18n';
import styles from './StaticPages.module.css';

export function CreditsPage() {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('credits.title')}</h1>
      <section className={styles.block}>
        <h2>{ASSET_CREDITS.fluent.name}</h2>
        <p>
          {ASSET_CREDITS.fluent.author} · {ASSET_CREDITS.fluent.license} ·{' '}
          <a href={ASSET_CREDITS.fluent.source} rel="noreferrer noopener" target="_blank">
            {ASSET_CREDITS.fluent.source}
          </a>
        </p>
      </section>
      <section className={styles.block}>
        <h2>{ASSET_CREDITS.noto.name}</h2>
        <p>
          {ASSET_CREDITS.noto.author} · {ASSET_CREDITS.noto.license} ·{' '}
          <a href={ASSET_CREDITS.noto.licenseUrl} rel="noreferrer noopener" target="_blank">
            {ASSET_CREDITS.noto.licenseUrl}
          </a>
        </p>
        <p>{ASSET_CREDITS.noto.notice}</p>
      </section>
      <section className={styles.block}>
        <h2>{t('credits.fonts')}</h2>
        <p>Baloo 2, Paytone One · SIL Open Font License 1.1</p>
      </section>
      <p>
        <Link to="/">{t('common.back')}</Link>
      </p>
    </main>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>404</h1>
      <p>{t('error.ROOM_NOT_FOUND')}</p>
      <p>
        <Link to="/">{t('common.back')}</Link>
      </p>
    </main>
  );
}
