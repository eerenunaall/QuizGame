import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import type { Locale } from '@quizparty/i18n';
import { I18nProvider } from '../ui/i18n';

/** Renders a screen inside the i18n provider (Turkish is the default language of the product). */
export function renderLocalized(ui: ReactElement, locale: Locale = 'tr') {
  return render(<I18nProvider locale={locale}>{ui}</I18nProvider>);
}
