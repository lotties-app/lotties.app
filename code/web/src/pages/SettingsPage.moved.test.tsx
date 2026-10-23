import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { HubFamilyPage, HubFormulasPage, HubImportPage, HubMedicinesPage } from './HubSubPages';
import { SettingsPage } from './SettingsPage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

function renderAt(route: string) {
  return renderWithDb(
    db,
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/hub/medicines" element={<HubMedicinesPage />} />
      <Route path="/hub/formulas" element={<HubFormulasPage />} />
      <Route path="/hub/family" element={<HubFamilyPage />} />
      <Route path="/hub/import" element={<HubImportPage />} />
    </Routes>,
    { route, api: fakeApi().api },
  );
}

describe('Settings keeps only preferences', () => {
  it('lists preferences and no longer the sections that moved to the Hub', async () => {
    await seedBaby(db, { medications: true });
    renderAt('/settings');
    await screen.findByRole('button', { name: 'Appearance' });
    for (const gone of ['Medications', 'Formulas', 'Import', 'Members & invites']) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: /Vaccines|Appointments|Notes/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy();
  });

  it('puts a gap between the title and the first card', async () => {
    await seedBaby(db);
    renderAt('/settings');
    const title = await screen.findByRole('heading', { name: 'Settings', level: 1 });
    const css = Array.from(document.querySelectorAll('style'), (n) => n.textContent).join('');
    const cls = title.className.split(' ').find((c) => c.startsWith('css-'))!;
    // Emotion writes `.css-xyz-MuiTypography-root{...margin-bottom:...}`; the theme spacing is a
    // CSS variable that jsdom cannot resolve, so the rule is read instead of the computed style.
    expect(css.split('}').find((rule) => rule.includes(`.${cls}`))).toMatch(/margin-bottom:/);
  });
});

describe('old links to sections that moved', () => {
  it.each([
    ['#medications', 'Medicines'],
    ['#formulas', 'Formulas'],
    ['#import', 'Import'],
    ['#members', 'Members and roles'],
  ])('redirect /settings%s to its Hub page', async (hash, title) => {
    await seedBaby(db, { medications: true });
    renderAt(`/settings${hash}`);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Hub' }).getAttribute('href')).toBe('/hub');
  });
});
