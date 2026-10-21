import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { Alert, Button, Card, Chip, SnackbarContent, TextField } from '@mui/material';
import { AppearanceSection } from '../settings/AppearanceSection';
import { AppThemeProvider } from './AppThemeProvider';
import { nightPeriodKey } from './nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY, NIGHT_FEED_STORAGE_KEY } from './nightFeedStorage';
import { THEME_STORAGE_KEY } from './themeStorage';

/** Sanity render of the restyled base components in every scheme (jsdom: no real colours). */
function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

describe.each(['light', 'dark', 'night'] as const)('base components in the %s scheme', (scheme) => {
  it('render without accessibility violations, with the label always shrunk above the value', async () => {
    chooseScheme(scheme);
    render(
      <AppThemeProvider>
        <main>
          <Card>
            <Button variant="contained">Save</Button>
            <Button variant="outlined">Cancel</Button>
            <Chip label="Running" color="success" />
            <Chip label="Late" color="warning" />
            <Chip label="Neutral" />
            <TextField label="Amount" defaultValue="" placeholder="ml" />
            <TextField label="Notes" multiline minRows={2} />
          </Card>
          <Alert severity="error">Could not save</Alert>
          <Alert severity="info">Heads up</Alert>
          <SnackbarContent message="Logged" />
        </main>
      </AppThemeProvider>,
    );
    expect(document.documentElement.hasAttribute(`data-${scheme}`)).toBe(true);
    // Labels are shrunk even though the fields are empty, so they cannot overlap or clip.
    for (const label of ['Amount', 'Notes']) {
      expect(screen.getByText(label, { selector: 'label' }).className).toContain(
        'MuiInputLabel-shrink',
      );
    }
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } }, // checked by tokens.test.ts
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('Appearance settings', () => {
  it('offers Night feed Off / Ask / Auto, defaulting to Ask, and stores the choice', () => {
    render(
      <AppThemeProvider>
        <AppearanceSection />
      </AppThemeProvider>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Night feed' });
    expect(group).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Ask' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(window.localStorage.getItem(NIGHT_FEED_STORAGE_KEY)).toBe('auto');
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(window.localStorage.getItem(NIGHT_FEED_STORAGE_KEY)).toBe('off');
  });

  it('keeps System as the default theme mode, then Light and Dark', () => {
    render(
      <AppThemeProvider>
        <AppearanceSection />
      </AppThemeProvider>,
    );
    const labels = screen
      .getAllByRole('radio')
      .slice(0, 3)
      .map((r) => (r as HTMLInputElement).value);
    expect(labels).toEqual(['system', 'light', 'dark']);
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
  });
});
