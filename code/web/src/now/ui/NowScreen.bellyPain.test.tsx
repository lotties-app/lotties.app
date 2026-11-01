import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import { eventType } from '../../presets/presetFixtures';
import type { PredictionsDto, TimeOfDayPatternDto } from '../../sync/contract';
import { BABY_ID, fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { readCachedPredictions } from '../../predictions/predictionsCache';
import { readBellyDismissal } from '../bellyPatternDismissal';
import { BABY, NOW_TYPES, nowApi, pinClock, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The belly pain suggestion on Now (docs/design/11-patterns.md): shown from 45 min before the usual
 * window while nothing was logged for it, with Start massage, Not today and Why?.
 */

const MASSAGE_TYPE = eventType({
  id: 'type-massage',
  key: 'belly_massage',
  name: 'Belly massage',
  hasDuration: true,
});
const TYPES = [...NOW_TYPES, MASSAGE_TYPE];

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

const PATTERN: TimeOfDayPatternDto = {
  typeKey: 'belly_pain',
  typicalClock: '18:00',
  windowStart: '17:30',
  windowEnd: '18:30',
  windowMinutes: 60,
  spreadMinutes: 10,
  confidence: 'Medium',
  eventDayCount: 6,
  recentDayCount: 5,
  timeZone: 'America/Sao_Paulo',
  days: [
    { date: '2026-10-15', times: ['17:50'] },
    { date: '2026-10-20', times: ['18:05', '18:20'] },
  ],
  rule: {
    lookBackDays: 14,
    recentDays: 7,
    minimumRecentDays: 4,
    maximumSpreadMinutes: 45,
    minimumCoveragePercent: 60,
    leadMinutes: 45,
  },
};

const withPattern = (): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: new Date().toISOString(),
  predictions: [],
  insufficientData: [],
  patterns: [PATTERN],
});

function renderNow(baby: Baby = BABY) {
  const { api, calls } = fakeApi(nowApi(withPattern()));
  const view = renderWithDb(db, <NowScreen baby={baby} />, { api });
  /** Resolves once the predictions (with the pattern) were served and had time to render. */
  const predictionsServed = async () => {
    await waitFor(() => expect(calls.some((c) => c.path.includes('/predictions'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  return { ...view, predictionsServed };
}

async function seed(role: Baby['role'] = 'Owner') {
  await seedNow(db, { types: TYPES, role });
  await seedMorning(db, 112);
}

const card = () => screen.findByRole('region', { name: 'Belly pain pattern' });

describe('the belly pain suggestion on Now', () => {
  it('shows 45 minutes before the usual window with the usual time', async () => {
    pinClock(17, 0);
    await seed();
    renderNow();

    const region = await card();
    expect(
      within(region).getByText('Belly pain often shows up around 18:00. A belly massage may help.'),
    ).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Start massage' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Not today' })).toBeTruthy();
  });

  it('is hidden outside the suggestion time', async () => {
    pinClock(16, 40);
    await seed();
    const view = renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    await view.predictionsServed();
    expect(screen.queryByText(/Belly pain often shows up/)).toBeNull();
  });

  it('is hidden once a belly pain was logged for this window', async () => {
    pinClock(17, 0);
    await seed();
    const pain = await putEvent(db, 'belly_pain', 10, 10, { intensity: 2 });
    const view = renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    await view.predictionsServed();
    expect(screen.queryByRole('region', { name: 'Belly pain pattern' })).toBeNull();

    // Deleting that entry (here or synced) brings the suggestion back.
    await db.events.update(pain.id, { deletedAt: new Date().toISOString() });
    expect(await card()).toBeTruthy();
  });

  it('"Not today" hides it for this window and stays hidden after a reload', async () => {
    pinClock(17, 0);
    await seed();
    const first = renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Not today' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Belly pain pattern' })).toBeNull(),
    );
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(readBellyDismissal(BABY.id)).toBe(key);

    first.unmount();
    // The reload starts from the cached predictions (the offline copy), pattern included.
    expect(readCachedPredictions(BABY.id)?.data.patterns).toHaveLength(1);
    renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    expect(screen.queryByRole('region', { name: 'Belly pain pattern' })).toBeNull();
  });

  it('"Why?" lists the window, the rule, the days and times, and the disclaimer', async () => {
    pinClock(17, 0);
    await seed();
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this suggestion?' });
    expect(within(sheet).getByText('Usual time: 17:30 to 18:30.')).toBeTruthy();
    expect(
      within(sheet).getByText('Belly pain was logged in this window on 5 of the last 7 days.'),
    ).toBeTruthy();
    expect(within(sheet).getByText(/at least 4 of the last 7 days/)).toBeTruthy();
    const days = within(sheet)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(days).toEqual([
      expect.stringMatching(/Oct.*: 18:05 and 18:20$/),
      expect.stringMatching(/Oct.*: 17:50$/),
    ]);
    expect(
      within(sheet).getByText(
        'This is a pattern from what you logged, not medical advice. If the pain keeps coming back, mention it to your pediatrician.',
      ),
    ).toBeTruthy();
  });

  it('"Start massage" starts the belly massage timer with nothing preset, and the card goes', async () => {
    pinClock(17, 0);
    await seed();
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Start massage' }));

    await waitFor(async () => {
      const massages = (await db.events.toArray()).filter((e) => e.typeId === MASSAGE_TYPE.id);
      expect(massages).toHaveLength(1);
      expect(massages[0]).toMatchObject({ endedAt: null, payload: {} });
    });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Belly pain pattern' })).toBeNull(),
    );
  });

  it('viewers see it without being able to start a massage', async () => {
    pinClock(17, 0);
    await seed('Viewer');
    renderNow({ ...BABY, role: 'Viewer' });

    const start = within(await card()).getByRole('button', { name: 'Start massage' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows in Portuguese', async () => {
    await useTestLocale('pt-BR');
    pinClock(17, 0);
    await seed();
    renderNow();

    const region = await screen.findByRole('region', { name: 'Padrão de dor de barriga' });
    expect(
      within(region).getByText(
        'A dor de barriga costuma aparecer por volta de 18:00. Uma massagem na barriguinha pode ajudar.',
      ),
    ).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Começar massagem' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Hoje não' })).toBeTruthy();
  });
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe.each(['light', 'dark'] as const)('the belly pain card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the Why sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      pinClock(17, 0);
      await seed();
      renderNow();
      const region = await screen.findByRole('region', {
        name: locale === 'en' ? 'Belly pain pattern' : 'Padrão de dor de barriga',
      });
      expect(await violations()).toEqual([]);

      fireEvent.click(
        within(region).getByRole('button', { name: locale === 'en' ? 'Why?' : 'Por quê?' }),
      );
      await screen.findByRole('dialog');
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
