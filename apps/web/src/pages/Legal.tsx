import { legal, type LegalDoc, type LegalDocId } from '@quizparty/i18n/legal';
import { Link } from '../lib/router';
import { useI18n } from '../lib/i18n';
import { LegalLinks } from '../ui/LegalLinks';
import styles from './Legal.module.css';

function DocBody({ doc, id }: { doc: LegalDoc; id: string }) {
  return (
    <>
      <h1 className={styles.title} id={id}>
        {doc.title}
      </h1>
      <p className={styles.status}>{doc.status}</p>
      {doc.sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h2>{section.heading}</h2>
          {section.items ? (
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {(section.paragraphs ?? []).map((text) => (
            <p key={text}>{text}</p>
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * /privacy, /terms and /support: the Turkish text first (the KVKK notice must be in Turkish), then the
 * English one, whatever the interface language. Static content only: no script, no inline style, so
 * the strict CSP of the web shell holds.
 */
export function LegalPage({ doc }: { doc: LegalDocId }) {
  const { locale } = useI18n();
  const order = ['tr', 'en'] as const;
  return (
    <main className={styles.page} data-testid={`legal-${doc}`}>
      <p className={styles.draft} role="note" data-testid="legal-draft-notice">
        {legal.tr.draftNotice}
        <br />
        <span lang="en">{legal.en.draftNotice}</span>
      </p>
      <p className={styles.jump}>
        <a href="#legal-en" lang="en">
          {legal.tr.jumpToOther}
        </a>
      </p>
      {order.map((lang) => (
        <article key={lang} lang={lang} className={styles.copy}>
          <DocBody doc={legal[lang].docs[doc]} id={`legal-${lang}`} />
        </article>
      ))}
      <LegalLinks className={styles.footer} />
      <p className={styles.back}>
        <Link to="/">{legal[locale].back}</Link>
      </p>
    </main>
  );
}
