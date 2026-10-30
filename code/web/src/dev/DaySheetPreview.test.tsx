import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import { I18nProvider } from '../i18n/I18nProvider';
import { fakeApi } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import DayPreview from './DayPreview';
import SheetPreview from './SheetPreview';

afterEach(async () => {
  for (const database of await indexedDB.databases()) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

function renderAt(route: string, ui: ReactElement) {
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthContext value={fakeAuth()}>
          <ApiClientContext value={fakeApi().api}>
            <QueryClientProvider client={new QueryClient()}>
              <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            </QueryClientProvider>
          </ApiClientContext>
        </AuthContext>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

describe('Day preview (developer route)', () => {
  it.each([
    ['full', 1, /Night sleep/],
    ['empty', 0, /No events this day yet/],
  ])('seeds and renders the %s scenario', async (state, offset, expected) => {
    renderAt(`/dev/day?state=${state}&offset=${offset}`, <DayPreview />);
    await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0), {
      timeout: 8000,
    });
  });
});

describe('Sheet preview (developer route)', () => {
  it.each([
    ['bottle', /Starting now/],
    ['edit', /Logged /],
    ['finish', /Finish this feeding/],
  ])('opens the %s scenario', async (state, expected) => {
    renderAt(`/dev/sheet?state=${state}`, <SheetPreview />);
    await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0), {
      timeout: 8000,
    });
  });
});
