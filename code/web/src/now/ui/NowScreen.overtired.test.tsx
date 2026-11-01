import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import type { PredictionsDto, WakeWindowDto } from '../../sync/contract';
import { SLEEP_TYPE } from '../../test/builtInTypes';
import { BABY_ID, fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { overtiredDismissal } from '../dismissalStore';
import {
  BABY,
  NOW_TYPES,
  minutesAgo,
  nowApi,
  pinClock,
  putEvent,
  seedMorning,
  seedNow,
} from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The overtired heads-up on Now ("hora da bruxa", docs/design/11-patterns.md section 6): shown
 * from 15 min before the usual longest comfortable awake stretch until 30 min after it, with
 * Start nap, Not now and Why?; hidden while a sleep runs.
 */

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

/** Five daytime stretches of the days before (2h to 2h 40m), oldest first. */
function stretches(): WakeWindowDto['stretches'] {
  return [120, 130, 150, 140, 160].map((minutes, index) => {
    const start = new Date(Date.now() - (5 - index) * 24 * 60 * 60_000);
    start.setHours(9 + index, 0, 0, 0);
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60_000).toISOString(),
      minutes,
    };
  });
}

const withWakeWindow = (): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: new Date().toISOString(),
  predictions: [],
  insufficientData: [],
  patterns: [],
  wakeWindow: {
    limitMinutes: 150,
    sampleCount: 5,
    awakeSince: minutesAgo(140),
    awakeMinutes: 140,
    timeZone: 'America/Sao_Paulo',
    stretches: stretches(),
    rule: {
      lookBackDays: 14,
      dayStartsAt: '05:00',
      dayEndsAt: '18:00',
      percentile: 75,
      minimumStretches: 5,
      leadMinutes: 15,
      graceMinutes: 30,
    },
  },
});

function renderNow(baby: Baby = BABY) {
  const { api, calls } = fakeApi(nowApi(withWakeWindow()));
  const view = renderWithDb(db, <NowScreen baby={baby} />, { api });
  /** Resolves once the predictions (with the wake window) were served and had time to render. */
  const predictionsServed = async () => {
    await waitFor(() => expect(calls.some((c) => c.path.includes('/predictions'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  return { ...view, predictionsServed };
}

/** A morning whose last nap ended `awakeMin` minutes ago. */
async function seed(awakeMin = 140, role: Baby['role'] = 'Owner') {
  await seedNow(db, { types: NOW_TYPES, role });
  await seedMorning(db, awakeMin);
}

const LABEL = 'Witching hour heads-up';
const card = () => screen.findByRole('region', { name: LABEL });

async function expectNoCard(view: ReturnType<typeof renderNow>) {
  await screen.findByRole('button', { name: /^Feed/ });
  await view.predictionsServed();
  expect(screen.queryByRole('region', { name: LABEL })).toBeNull();
}

describe('the overtired heads-up on Now', () => {
  it('shows near the usual limit with the awake time and the limit', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow();

    const region = await card();
    expect(
      within(region).getByText(
        'Witching hour soon: awake for 2h 20m, usually fussy after about 2h 30m. A nap soon may help.',
      ),
    ).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Start nap' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Why?' })).toBeTruthy();
  });

  it('is hidden more than 15 min before the limit', async () => {
    pinClock(15, 0);
    await seed(130);
    await expectNoCard(renderNow());
  });

  it('is hidden from 30 min after the limit', async () => {
    pinClock(15, 0);
    await seed(180);
    await expectNoCard(renderNow());
  });

  it('is hidden while a sleep runs', async () => {
    pinClock(15, 0);
    await seed(140);
    await putEvent(db, 'sleep', 5, null, { kind: 'nap' });
    await expectNoCard(renderNow());
  });

  it('is hidden after a night waking since the last sleep', async () => {
    pinClock(15, 0);
    await seed(140);
    await putEvent(db, 'sleep', 140, 120, { kind: 'night_waking' });
    await expectNoCard(renderNow());
  });

  it('"Not now" hides it for this awake stretch and stays hidden after a reload', async () => {
    pinClock(15, 0);
    await seed(140);
    const first = renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: LABEL })).toBeNull());
    expect(overtiredDismissal.read(BABY.id)).toBe(new Date(minutesAgo(140)).toISOString());

    first.unmount();
    renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    expect(screen.queryByRole('region', { name: LABEL })).toBeNull();
  });

  it('"Why?" lists the awake time, the limit, the rule, the stretches and the disclaimer', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this suggestion?' });
    expect(within(sheet).getByText('Awake since 12:40: 2h 20m.')).toBeTruthy();
    expect(
      within(sheet).getByText('Usual longest comfortable awake time: about 2h 30m.'),
    ).toBeTruthy();
    expect(
      within(sheet).getByText(
        /^About 75% of the 5 daytime awake stretches below lasted this long or less .*between 05:00 and 18:00 in the last 14 days; at least 5 are needed\)\. The note shows from 15 min before that time until 30 min after it\.$/,
      ),
    ).toBeTruthy();
    const items = within(sheet)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatch(/, 13:00 to 15:40: 2h 40m$/);
    expect(
      within(sheet).getByText(
        'This is a pattern from what you logged, not medical advice. If the crying worries you, talk to your pediatrician.',
      ),
    ).toBeTruthy();
  });

  it('"Start nap" starts the nap timer and the card goes', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Start nap' }));

    await waitFor(async () => {
      const running = (await db.events.toArray()).filter(
        (e) => e.typeId === SLEEP_TYPE.id && e.endedAt === null,
      );
      expect(running).toHaveLength(1);
      expect(running[0].payload).toMatchObject({ kind: 'nap' });
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: LABEL })).toBeNull());
  });

  it('viewers see it without being able to start a nap', async () => {
    pinClock(15, 0);
    await seed(140, 'Viewer');
    renderNow({ ...BABY, role: 'Viewer' });

    const start = within(await card()).getByRole('button', { name: 'Start nap' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows in Portuguese with gender-free wording', async () => {
    await useTestLocale('pt-BR');
    pinClock(15, 0);
    await seed(140);
    renderNow();

    const region = await screen.findByRole('region', { name: 'Aviso da hora da bruxa' });
    expect(
      within(region).getByText(
        'A hora da bruxa está chegando: tempo acordado 2 h 20 min, e a irritação costuma começar depois de cerca de 2 h 30 min. Uma soneca em breve pode ajudar.',
      ),
    ).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Começar soneca' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Agora não' })).toBeTruthy();
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

describe.each(['light', 'dark'] as const)('the overtired card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the Why sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      pinClock(15, 0);
      await seed(140);
      renderNow();
      const region = await screen.findByRole('region', {
        name: locale === 'en' ? LABEL : 'Aviso da hora da bruxa',
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
