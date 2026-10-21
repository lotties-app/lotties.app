import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider } from '../i18n/I18nProvider';
import { AppThemeProvider } from '../theme/AppThemeProvider';

/** Renders `ui` with the app's language and theme providers only (no data layer). */
export function renderUi(ui: ReactNode) {
  return render(
    <I18nProvider>
      <AppThemeProvider>{ui}</AppThemeProvider>
    </I18nProvider>,
  );
}
