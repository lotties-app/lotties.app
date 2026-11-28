import { fireEvent, screen } from '@testing-library/react';
import { Link } from 'react-router-dom';
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
    // No baby, no Day summary: no tab bar at all.
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: fakeApi(measurementsApi).api });
    expect(screen.getByRole('heading', { name: 'Insights', level: 1 })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Mais análises a caminho' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Crescimento', level: 2 })).toBeTruthy();
  });

  it('adds a Day tab after Insights, which stays first, selected and unchanged', async () => {
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: fakeApi(measurementsApi).api });
    expect(await screen.findByRole('tab', { name: 'Insights', selected: true })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Insights', 'Day']);
    const panel = screen.getByRole('tabpanel', { name: 'Insights' });
    expect(panel.querySelector('#growth')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'More insights are coming' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
  });

  it('opens the Day summary, and a #growth link brings Insights back', async () => {
    await seedBaby(db);
    renderWithDb(
      db,
      <>
        <InsightsPage />
        <Link to="#growth">Add measurements</Link>
      </>,
      { api: fakeApi(measurementsApi).api },
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Day' }));
    expect(screen.getByRole('tab', { name: 'Day', selected: true })).toBeTruthy();
    expect(await screen.findByRole('group', { name: 'Day shown' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nothing logged yet today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Growth' })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Add measurements' }));
    expect(await screen.findByRole('tab', { name: 'Insights', selected: true })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
  });

  it('opens on Insights with Growth for a #growth link', async () => {
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: fakeApi(measurementsApi).api, route: '/#growth' });
    expect(await screen.findByRole('tab', { name: 'Insights', selected: true })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Growth', level: 2 })).toBeTruthy();
  });
});
