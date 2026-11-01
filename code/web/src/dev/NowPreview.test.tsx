import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import { I18nProvider } from '../i18n/I18nProvider';
import { fakeApi } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import NowPreview from './NowPreview';

afterEach(async () => {
  for (const database of await indexedDB.databases()) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

function renderPreview(state: string) {
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthContext value={fakeAuth()}>
          <ApiClientContext value={fakeApi().api}>
            <QueryClientProvider client={new QueryClient()}>
              <MemoryRouter initialEntries={[`/dev/now?state=${state}`]}>
                <NowPreview />
              </MemoryRouter>
            </QueryClientProvider>
          </ApiClientContext>
        </AuthContext>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

describe('Now preview (developer route)', () => {
  it.each([
    ['empty', /first event/],
    ['learning', /Learning Lia/],
    ['awake', /Nap window/],
    ['nap', /Asleep · Nap/],
    ['night', /Asleep · Night/],
    ['waking', /Night waking/],
    ['nursing', /Nursing/],
    ['forgotten', /Still asleep\?/],
    ['catchup', /What changed since your last look/],
    ['viewer', /view-only access/],
    ['cry', /Why is she crying\?/],
  ])('seeds and renders the %s scenario', async (state, expected) => {
    renderPreview(state);
    // The catch-up is a header button now: its text is its accessible name.
    const found = () =>
      state === 'catchup'
        ? screen.queryAllByRole('button', { name: expected })
        : screen.queryAllByText(expected);
    await waitFor(() => expect(found().length).toBeGreaterThan(0), { timeout: 8000 });
  });
});
