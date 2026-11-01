import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { BabyEvent } from '../../db/models';
import { eventType } from '../../presets/presetFixtures';
import type { PredictionsDto, TimeOfDayPatternDto } from '../../sync/contract';
import { BABY_ID, fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { fussyDismissal } from '../dismissalStore';
import { BABY, NOW_TYPES, minutesAgo, nowApi, pinClock, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The fussy pattern suggestion on Now (docs/design/11-patterns.md section 7): the belly pain card's
 * rules over fussy spells, with Not today and Why? only (no action to run).
 */

const FUSSY_TYPE = eventType({
  id: 'type-fussy',
  key: 'fussy',
  name: 'Fussy / crying',
  hasDuration: true,
});
const TYPES = [...NOW_TYPES, FUSSY_TYPE];

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
  typeKey: 'fussy',
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
    { date: '2026-10-20', times: ['18:05'] },
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

function renderNow() {
  const { api, calls } = fakeApi(nowApi(withPattern()));
  const view = renderWithDb(db, <NowScreen baby={BABY} />, { api });
  const predictionsServed = async () => {
    await waitFor(() => expect(calls.some((c) => c.path.includes('/predictions'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  return { ...view, predictionsServed };
}

async function seed() {
  await seedNow(db, { types: TYPES });
  await seedMorning(db, 112);
}

/** A fussy spell that started `startAgo` minutes ago (running when `endAgo` is null). */
async function putFussy(startAgo: number, endAgo: number | null): Promise<BabyEvent> {
  const startedAt = minutesAgo(startAgo);
  const stored: BabyEvent = {
    id: `fussy-${startAgo}`,
    babyId: BABY_ID,
    typeId: FUSSY_TYPE.id,
    startedAt,
    endedAt: endAgo === null ? null : minutesAgo(endAgo),
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
  await db.events.put(stored);
  return stored;
}

const LABEL = 'Fussy time pattern';
const card = () => screen.findByRole('region', { name: LABEL });

describe('the fussy pattern suggestion on Now', () => {
  it('shows 45 minutes before the usual window with Not today and Why? only', async () => {
    pinClock(17, 0);
    await seed();
    renderNow();

    const region = await card();
    expect(
      within(region).getByText('Fussiness often starts around 18:00. A calm routine may help.'),
    ).toBeTruthy();
    expect(
      within(region)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Why?', 'Not today']);
  });

  it('is hidden outside the suggestion time', async () => {
    pinClock(16, 40);
    await seed();
    const view = renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    await view.predictionsServed();
    expect(screen.queryByRole('region', { name: LABEL })).toBeNull();
  });

  it('is hidden once a fussy spell was logged for this window, also a running one', async () => {
    pinClock(17, 0);
    await seed();
    const spell = await putFussy(10, null);
    const view = renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    await view.predictionsServed();
    expect(screen.queryByRole('region', { name: LABEL })).toBeNull();

    await db.events.update(spell.id, { deletedAt: new Date().toISOString() });
    expect(await card()).toBeTruthy();
  });

  it('"Not today" hides it for this window and stays hidden after a reload', async () => {
    pinClock(17, 0);
    await seed();
    const first = renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Not today' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: LABEL })).toBeNull());
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(fussyDismissal.read(BABY.id)).toBe(key);

    first.unmount();
    renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    expect(screen.queryByRole('region', { name: LABEL })).toBeNull();
  });

  it('"Why?" lists the window, the rule, the days and times, and the disclaimer', async () => {
    pinClock(17, 0);
    await seed();
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this suggestion?' });
    expect(within(sheet).getByText('Usual time: 17:30 to 18:30.')).toBeTruthy();
    expect(
      within(sheet).getByText('A fussy spell was logged in this window on 5 of the last 7 days.'),
    ).toBeTruthy();
    expect(within(sheet).getByText(/days with a fussy spell in the last 14 days\.$/)).toBeTruthy();
    const days = within(sheet)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(days).toEqual([
      expect.stringMatching(/Oct.*: 18:05$/),
      expect.stringMatching(/Oct.*: 17:50$/),
    ]);
    expect(
      within(sheet).getByText(
        'This is a pattern from what you logged, not medical advice. If the crying worries you, mention it to your pediatrician.',
      ),
    ).toBeTruthy();
  });

  it('shows in Portuguese', async () => {
    await useTestLocale('pt-BR');
    pinClock(17, 0);
    await seed();
    renderNow();

    const region = await screen.findByRole('region', { name: 'Padrão de irritação' });
    expect(
      within(region).getByText(
        'A irritação costuma começar por volta de 18:00. Uma rotina calma pode ajudar.',
      ),
    ).toBeTruthy();
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

describe.each(['light', 'dark'] as const)('the fussy pattern card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the Why sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      pinClock(17, 0);
      await seed();
      renderNow();
      const region = await screen.findByRole('region', {
        name: locale === 'en' ? LABEL : 'Padrão de irritação',
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
