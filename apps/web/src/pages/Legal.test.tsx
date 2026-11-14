import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { legal } from '@quizparty/i18n/legal';
import { I18nProvider } from '../lib/i18n';
import { LegalLinks } from '../ui/LegalLinks';
import { CodeEntry } from './CodeEntry';
import { LegalPage } from './Legal';

afterEach(cleanup);

describe('legal pages', () => {
  it.each(['privacy', 'terms', 'support'] as const)(
    '/%s shows the Turkish text first, then the English one, under a draft notice',
    (doc) => {
      render(
        <I18nProvider locale="en">
          <LegalPage doc={doc} />
        </I18nProvider>,
      );
      const page = screen.getByTestId(`legal-${doc}`);
      const headings = within(page).getAllByRole('heading', { level: 1 });
      expect(headings.map((h) => h.textContent)).toEqual([
        legal.tr.docs[doc].title,
        legal.en.docs[doc].title,
      ]);
      expect(headings[0]!.closest('article')!.getAttribute('lang')).toBe('tr');
      expect(headings[1]!.closest('article')!.getAttribute('lang')).toBe('en');
      const notice = screen.getByTestId('legal-draft-notice').textContent ?? '';
      expect(notice).toContain('hukuki tavsiye değildir');
      expect(notice).toContain('not legal advice');
      // nothing on the page needs a script or an inline style (strict CSP)
      expect(page.querySelectorAll('script, [style]')).toHaveLength(0);
    },
  );

  it('the privacy page carries the KVKK notice sections and the owner placeholders', () => {
    render(
      <I18nProvider locale="tr">
        <LegalPage doc="privacy" />
      </I18nProvider>,
    );
    for (const heading of ['1. Veri sorumlusu', '7. Hakların (KVKK md. 11)', '9. İletişim'])
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.getAllByText(/OWNER-TO-FILL/u).length).toBeGreaterThan(3);
  });

  it('the terms carry the trademark notice', () => {
    render(
      <I18nProvider locale="tr">
        <LegalPage doc="terms" />
      </I18nProvider>,
    );
    expect(
      screen.getByText(/QuizNight is not affiliated with, endorsed or sponsored by the owners/u),
    ).toBeTruthy();
  });

  it('the links follow the interface language and point at the three pages', () => {
    render(
      <I18nProvider locale="tr">
        <LegalLinks />
      </I18nProvider>,
    );
    const links = within(screen.getByTestId('legal-links')).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Gizlilik', '/privacy'],
      ['Kullanım koşulları', '/terms'],
      ['Destek', '/support'],
    ]);
  });

  it('the phone front door links to them', () => {
    render(
      <I18nProvider locale="en">
        <CodeEntry />
      </I18nProvider>,
    );
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/privacy');
  });
});
