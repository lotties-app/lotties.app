import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { activateLocale } from '../../i18n/i18n';
import type { PresetActions } from '../../presets/usePresetActions';
import { BABY_ID, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { MoreSheet } from './MoreSheet';
import { NOW_TYPES, putEvent } from './nowKit';

let db: BabyRoutineDb;
let actions: PresetActions;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = testDatabase();
  actions = { run: vi.fn(async () => {}), stop: vi.fn(async () => {}), elements: null };
  onClose = vi.fn();
});

afterEach(async () => {
  await settleSync();
  vi.unstubAllGlobals();
  await activateLocale('en');
  await db.delete();
});

/** Emulates the primary pointer: `fine` (mouse) or `coarse` (touch). */
function pointer(kind: 'fine' | 'coarse') {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(pointer: fine)' && kind === 'fine',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

function renderSheet() {
  renderWithDb(
    db,
    <MoreSheet
      open
      onClose={onClose}
      babyId={BABY_ID}
      userId="u-me"
      types={NOW_TYPES}
      events={[]}
      actions={actions}
      readOnly={false}
      onOpenTray={() => {}}
      onStartNursing={() => {}}
    />,
  );
}

async function tiles() {
  const grid = await screen.findByTestId('more-grid');
  await within(grid).findAllByRole('button');
  return names(grid);
}
const names = (grid: HTMLElement) =>
  within(grid)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label')?.split(',')[0]);
const search = () => screen.getByRole('searchbox', { name: 'Search' });
const type = (text: string) => fireEvent.change(search(), { target: { value: text } });
const status = () => within(screen.getByRole('search')).getByRole('status');

describe('More sheet search', () => {
  it('filters the tiles as the person types, case- and accent-insensitive, words in any order', async () => {
    pointer('coarse');
    renderSheet();
    expect(await tiles()).toHaveLength(13);

    type('TUM');
    expect(names(screen.getByTestId('more-grid'))).toEqual(['Start Tummy time']);
    expect(status().textContent).toBe('1 result');

    type('time tummy');
    expect(names(screen.getByTestId('more-grid'))).toEqual(['Start Tummy time']);

    type('night');
    expect(names(screen.getByTestId('more-grid'))).toEqual(['Start Night waking']);
  });

  it('matches the pt-BR names without accents', async () => {
    pointer('coarse');
    await useTestLocale('pt-BR');
    renderSheet();
    await tiles();
    const input = screen.getByRole('searchbox', { name: 'Buscar' });

    fireEvent.change(input, { target: { value: 'remedio' } });
    const grid = screen.getByTestId('more-grid');
    expect(within(grid).getAllByRole('button')).toHaveLength(1);
    expect(grid.textContent).toMatch(/Remédio/);

    fireEvent.change(input, { target: { value: 'barriga dor' } });
    expect(grid.textContent).toMatch(/Dor de barriga/);
    expect(within(grid).getAllByRole('button')).toHaveLength(1);

    fireEvent.change(input, { target: { value: 'AMAMENTACAO' } });
    expect(grid.textContent).toMatch(/Amamentação/);
    expect(within(screen.getByRole('search')).getByRole('status').textContent).toBe(
      '1 resultado',
    );
  });

  it('keeps the usage order under a query', async () => {
    pointer('coarse');
    await putEvent(db, 'tummy_time', 60, 50);
    await putEvent(db, 'tummy_time', 600, 590);
    renderSheet();
    expect((await tiles())[0]).toBe('Start Tummy time');

    type('t');
    const shown = names(screen.getByTestId('more-grid'));
    expect(shown[0]).toBe('Start Tummy time');
    expect(shown.slice(1)).toEqual([
      'Log Bath',
      'Log Bedtime',
      'Start Bottle',
      'Log Medication',
      'Start Night waking',
      'Custom',
    ]);
  });

  it('says so when nothing matches, and clearing brings every tile back', async () => {
    pointer('coarse');
    renderSheet();
    await tiles();

    type('zzz');
    expect(names(screen.getByTestId('more-grid'))).toEqual([]);
    expect(status().textContent).toBe('No results');

    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect((search() as HTMLInputElement).value).toBe('');
    expect(names(screen.getByTestId('more-grid'))).toHaveLength(13);
    expect(status().textContent).toBe('');
  });

  it('Esc clears the query first, then closes the sheet', async () => {
    pointer('coarse');
    renderSheet();
    await tiles();

    type('bath');
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect((search() as HTMLInputElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    expect(names(screen.getByTestId('more-grid'))).toHaveLength(13);

    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter never logs anything: only a tap on a tile does', async () => {
    pointer('coarse');
    renderSheet();
    await tiles();

    type('tummy');
    fireEvent.keyDown(search(), { key: 'Enter' });
    fireEvent.submit(screen.getByRole('search'));
    expect(actions.run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Start Tummy time/ }));
    await waitFor(() => expect(actions.run).toHaveBeenCalledTimes(1));
  });

  it('focuses the field on open only with a fine pointer', async () => {
    pointer('coarse');
    renderSheet();
    await tiles();
    expect(document.activeElement).not.toBe(search());
  });

  it('focuses the field on open with a mouse', async () => {
    pointer('fine');
    renderSheet();
    await tiles();
    await waitFor(() => expect(document.activeElement).toBe(search()));
    expect(search().getAttribute('autocomplete')).toBe('off');
  });

  it('is an accessible search landmark', async () => {
    pointer('coarse');
    renderSheet();
    await tiles();
    type('ba');
    const sheet = screen.getByRole('dialog', { name: 'More' });
    const results = await axe.run(sheet);
    expect(results.violations).toEqual([]);
  });
});
