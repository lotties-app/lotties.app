import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import type { DiaperPredictionsDto, PredictionsDto } from '../../sync/contract';
import { DIAPER_TYPE } from '../../test/builtInTypes';
import { BABY_ID, fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { diaperWetDismissal } from '../dismissalStore';
import { BABY, NOW_TYPES, minutesAgo, nowApi, pinClock, putEvent, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The diaper cards on Now (docs/design/11-patterns.md section 8): shown from 20 min before the
 * expected wet or dirty diaper until 40 min after it, with Log diaper, Not now and Why?; anchored
 * at the latest local diaper of the kind (or the end of the latest feed), so logging one hides
 * the card. The clock is pinned at 15:00 local.
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

const RULE: DiaperPredictionsDto['rule'] = {
  wetLookBackDays: 7,
  minimumWetEvents: 8,
  dirtyLookBackDays: 14,
  minimumDirtyEvents: 5,
  lowerPercentile: 25,
  upperPercentile: 75,
  feedWindowMinutes: 180,
  minimumFeedPairs: 5,
  maximumLagSpreadMinutes: 40,
  leadMinutes: 20,
  graceMinutes: 40,
};

interface Setup {
  /** Minutes ago of the server's latest wet diaper (usual gap 2h30, 2h10-2h50). */
  wetAgo?: number | null;
  /** The usual lag after feeds (30/35/40 min) when true. */
  afterFeed?: boolean;
  dropped?: boolean;
}

function diaperPredictions({
  wetAgo = 140,
  afterFeed = false,
  dropped = false,
}: Setup): PredictionsDto {
  const wet =
    wetAgo === null
      ? null
      : {
          anchorAt: minutesAgo(wetAgo),
          nextStart: {
            earliest: minutesAgo(wetAgo - 130),
            expected: minutesAgo(wetAgo - 150),
            latest: minutesAgo(wetAgo - 170),
          },
          lowerGapMinutes: 130,
          medianGapMinutes: 150,
          upperGapMinutes: 170,
          eventCount: 40,
          gapCount: 39,
          confidence: 'Medium' as const,
          trend: dropped
            ? { last24Hours: 2, usualPer24Hours: 7.5, droppedSharply: true }
            : { last24Hours: 7, usualPer24Hours: 7.5, droppedSharply: false },
        };
  return {
    babyId: BABY_ID,
    generatedAt: new Date().toISOString(),
    predictions: [],
    insufficientData: [],
    diaper: {
      wet,
      dirty: afterFeed
        ? {
            lastDirtyAt: minutesAgo(600),
            gap: null,
            afterFeed: {
              lowerLagMinutes: 30,
              medianLagMinutes: 35,
              upperLagMinutes: 40,
              pairCount: 9,
              confidence: 'Medium',
              latestFeedEndedAt: minutesAgo(35),
            },
          }
        : null,
      rule: RULE,
    },
  };
}

function renderNow(setup: Setup = {}, baby: Baby = BABY) {
  const { api, calls } = fakeApi(nowApi(diaperPredictions(setup)));
  const view = renderWithDb(db, <NowScreen baby={baby} />, { api });
  /** Resolves once the predictions were served and had time to render. */
  const predictionsServed = async () => {
    await waitFor(() => expect(calls.some((c) => c.path.includes('/predictions'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  return { ...view, predictionsServed };
}

/** A nap this morning and the latest wet diaper `wetAgo` minutes ago (and, with `feedAgo`, a feed that ended then). */
async function seed(wetAgo = 140, role: Baby['role'] = 'Owner', feedAgo?: number) {
  await seedNow(db, { types: NOW_TYPES, role });
  await putEvent(db, 'sleep', 400, 330, { kind: 'nap' });
  await putEvent(db, 'diaper', wetAgo, wetAgo, { content: 'WET' });
  if (feedAgo !== undefined) {
    await putEvent(db, 'feeding', feedAgo + 15, feedAgo, { method: 'bottle', amount_ml: 120 });
  }
}

const WET = 'Wet diaper heads-up';
const DIRTY = 'Dirty diaper heads-up';
const card = (name = WET) => screen.findByRole('region', { name });

async function expectNoCard(view: ReturnType<typeof renderNow>, name = WET) {
  await screen.findByRole('button', { name: /^Feed/ });
  await view.predictionsServed();
  expect(screen.queryByRole('region', { name })).toBeNull();
}

describe('the wet diaper card on Now', () => {
  it('shows around the expected wet diaper with Log diaper, Not now and Why?', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow();

    const region = await card();
    expect(within(region).getByText('Diaper check likely around 15:10.')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Log diaper' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Why?' })).toBeTruthy();
  });

  it('is hidden more than 20 min before the expected time', async () => {
    pinClock(15, 0);
    await seed(100);
    await expectNoCard(renderNow({ wetAgo: 100 }));
  });

  it('is hidden from 40 min after the expected time', async () => {
    pinClock(15, 0);
    await seed(240);
    await expectNoCard(renderNow({ wetAgo: 240 }));
  });

  it('is hidden without a wet estimate', async () => {
    pinClock(15, 0);
    await seed(140);
    await expectNoCard(renderNow({ wetAgo: null }));
  });

  it('"Log diaper" opens the diaper tray, and logging a wet diaper hides the card', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Log diaper' }));
    const tray = await screen.findByRole('dialog', { name: 'Diaper' });
    fireEvent.click(within(tray).getByRole('button', { name: /^Wet/ }));

    await waitFor(async () => {
      const wet = (await db.events.toArray()).filter(
        (e) => e.typeId === DIAPER_TYPE.id && e.payload.content === 'WET',
      );
      expect(wet).toHaveLength(2);
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: WET })).toBeNull());
  });

  it('"Not now" hides it for this anchor and stays hidden after a reload', async () => {
    pinClock(15, 0);
    await seed(140);
    const first = renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: WET })).toBeNull());
    expect(diaperWetDismissal.read(BABY.id)).toBe(new Date(minutesAgo(140)).toISOString());

    first.unmount();
    renderNow();
    await screen.findByRole('button', { name: /^Feed/ });
    expect(screen.queryByRole('region', { name: WET })).toBeNull();
  });

  it('"Why?" gives the window, the latest wet diaper, the gap, the rule, the confidence and the disclaimer', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow();

    fireEvent.click(within(await card()).getByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this suggestion?' });
    expect(
      within(sheet).getByText(
        'Next wet diaper likely around 15:10, usually between 14:50 and 15:30.',
      ),
    ).toBeTruthy();
    expect(within(sheet).getByText('Last wet diaper: 12:40.')).toBeTruthy();
    expect(
      within(sheet).getByText(
        'Typical time between wet diapers: about 2h 30m, from 40 wet diapers in the last 7 days.',
      ),
    ).toBeTruthy();
    expect(
      within(sheet).getByText(
        /^A wet diaper is one logged as wet or mixed\. The estimate needs at least 8 wet diapers in the last 7 days; .* from 20 min before the expected time until 40 min after it\.$/,
      ),
    ).toBeTruthy();
    expect(within(sheet).getByText('Confidence: medium.')).toBeTruthy();
    expect(
      within(sheet).getByText('This is a pattern from what you logged, not medical advice.'),
    ).toBeTruthy();
    expect(within(sheet).queryByText(/pediatrician/)).toBeNull();
  });

  it('"Why?" mentions the pediatrician gently only when wet diapers dropped sharply', async () => {
    pinClock(15, 0);
    await seed(140);
    renderNow({ dropped: true });

    fireEvent.click(within(await card()).getByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this suggestion?' });
    expect(
      within(sheet).getByText(
        'Wet diapers in the last 24 hours: 2, fewer than usual (about 7.5 a day). If that continues, mention it to your pediatrician.',
      ),
    ).toBeTruthy();
  });

  it('viewers see it without being able to log', async () => {
    pinClock(15, 0);
    await seed(140, 'Viewer');
    renderNow({}, { ...BABY, role: 'Viewer' });

    const log = within(await card()).getByRole('button', { name: 'Log diaper' });
    expect((log as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows in Portuguese', async () => {
    await useTestLocale('pt-BR');
    pinClock(15, 0);
    await seed(140);
    renderNow();

    const region = await screen.findByRole('region', { name: 'Aviso de fralda molhada' });
    expect(within(region).getByText('Troca de fralda provável por volta de 15:10.')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Registrar fralda' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Agora não' })).toBeTruthy();
  });
});

describe('the dirty diaper card on Now', () => {
  it('after a feed shows the usual lag and explains it', async () => {
    pinClock(15, 0);
    await seed(30, 'Owner', 35);
    renderNow({ wetAgo: 30, afterFeed: true });

    const region = await card(DIRTY);
    expect(
      within(region).getByText('A dirty diaper often follows feeds after about 35 minutes.'),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: WET })).toBeNull();

    fireEvent.click(within(region).getByRole('button', { name: 'Why?' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why this suggestion?' });
    expect(
      within(sheet).getByText(
        'The last feed ended at 14:25: a dirty diaper usually follows between 14:55 and 15:05.',
      ),
    ).toBeTruthy();
    expect(
      within(sheet).getByText(
        'After a feed, a dirty diaper came about 35 min after it ended (usually 30 to 40 min), from 9 dirty diapers with a feed in the 3 hours before.',
      ),
    ).toBeTruthy();
    expect(
      within(sheet).getByText('This is a pattern from what you logged, not medical advice.'),
    ).toBeTruthy();
  });

  it('is hidden once a dirty diaper was logged after the feed', async () => {
    pinClock(15, 0);
    await seed(30, 'Owner', 35);
    await putEvent(db, 'diaper', 10, 10, { content: 'DIRTY' });
    await expectNoCard(renderNow({ wetAgo: 30, afterFeed: true }), DIRTY);
  });

  it('shows in Portuguese with the lag in minutes', async () => {
    await useTestLocale('pt-BR');
    pinClock(15, 0);
    await seed(30, 'Owner', 35);
    renderNow({ wetAgo: 30, afterFeed: true });

    const region = await screen.findByRole('region', { name: 'Aviso de fralda suja' });
    expect(
      within(region).getByText(
        'Uma fralda suja costuma vir cerca de 35 minutos depois das mamadas.',
      ),
    ).toBeTruthy();
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

describe.each(['light', 'dark'] as const)('the diaper card in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, also with the Why sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      pinClock(15, 0);
      await seed(140);
      renderNow();
      const region = await screen.findByRole('region', {
        name: locale === 'en' ? WET : 'Aviso de fralda molhada',
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
