import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { InsightsPage } from './InsightsPage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const measurementsApi = (call: { path: string }) =>
  call.path.includes('/measurements') ? [] : undefined;

describe('InsightsPage', () => {
  it('has its own heading, the insights on their way and Growth under it', async () => {
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: fakeApi(measurementsApi).api });

    expect(screen.getByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'More insights are coming' })).toBeTruthy();
    expect(await screen.findByText(/Each one opens after a few days of logging/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Sleep rhythm' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Add measurement' })).toBeTruthy();
  });

  it('asks to create a baby first when there is none', async () => {
    renderWithDb(db, <InsightsPage />, { api: fakeApi(measurementsApi).api });
    expect(await screen.findByText(/Create a baby on the Now screen to track growth/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'More insights are coming' })).toBeTruthy();
    expect(screen.getByText(/Sleep rhythm, feeding and diaper trends/)).toBeTruthy();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: fakeApi(measurementsApi).api });
    expect(screen.getByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Mais análises a caminho' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Crescimento', level: 2 })).toBeTruthy();
  });
});
