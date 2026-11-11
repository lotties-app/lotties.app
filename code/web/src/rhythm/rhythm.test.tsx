import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { i18n } from '../i18n/i18n';
import enRhythm from '../i18n/locales/en/rhythm.json';
import ptRhythm from '../i18n/locales/pt-BR/rhythm.json';
import { LOCALE_STORAGE_KEY } from '../i18n/localeStorage';
import { InsightsPage } from '../pages/InsightsPage';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { nightPeriodKey } from '../theme/nightFeed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { DEFAULT_RHYTHM_RULE, parseRhythm, type Rhythm } from './rhythmApi';
import { rhythmFixture, RHYTHM_SCENARIOS, type RhythmScenario } from './rhythmFixtures';
import {
  associationSentences,
  comparisonState,
  missingForClock,
  missingForGap,
  missingForNaps,
  missingForNights,
  missingText,
  needsMore,
  variesText,
} from './rhythmModel';
import { RhythmSection } from './RhythmSection';

/* Causal, judging or advising words never shown by the rhythm (docs/design/48-baby-rhythm.md section 4). */
const FORBIDDEN = {
  en: /\b(because|causes?|caused|help|helps|helped|should|better|worse|normal|abnormal|recommend\w*|significant\w*)\b/i,
  'pt-BR':
    /(^|[^\p{L}])(porque|causa\w*|causou|ajuda\w*|deve|devem|deveria\w*|melhor|pior|normal|anormal|recomend\w*|significativ\w*)(?![\p{L}])/iu,
};

const t = ((...args: Parameters<TFunction>) => i18n.t(...args)) as unknown as TFunction;
const parsed = (scenario: RhythmScenario): Rhythm => parseRhythm(rhythmFixture(scenario))!;

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  vi.restoreAllMocks();
  await useTestLocale('en');
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  window.localStorage.removeItem(NIGHT_FEED_STATE_STORAGE_KEY);
});

describe('parseRhythm', () => {
  it('reads the wire shape of the design', () => {
    const rhythm = parsed('ok');
    expect(rhythm.nights).toBe(26);
    expect(rhythm.bedTime).toEqual({ status: 'ok', usual: '19:45', spreadMinutes: 18, nights: 26 });
    expect(rhythm.nightLength.range).toEqual({ p25: 600, median: 625, p75: 645 });
    expect(rhythm.naps.range).toEqual({ p25: 3, median: 3, p75: 3.5 });
    expect(rhythm.naps.usualStarts.map((s) => s.usual)).toEqual(['09:05', '12:40', '16:15']);
    expect(rhythm.feeds.gap.range).toEqual({ p25: 150, median: 170, p75: 195 });
    expect(rhythm.associations.map((a) => a.factor)).toEqual(['evening_feeds', 'dirty_diaper_day']);
    expect(rhythm.associations[0].outcomes[0]).toMatchObject({
      status: 'ok',
      differenceMinutes: 40,
      nightsWith: 12,
      nightsWithout: 10,
    });
    expect(rhythm.rule).toEqual(DEFAULT_RHYTHM_RULE);
  });

  it('is null for an answer not shaped like a rhythm (older server)', () => {
    expect(parseRhythm([])).toBeNull();
    expect(parseRhythm(null)).toBeNull();
    expect(parseRhythm({ nights: 3 })).toBeNull();
  });

  it('turns an unknown status into unknown and keeps no value', () => {
    const body = rhythmFixture('ok') as Record<string, unknown>;
    const rhythm = parseRhythm({
      ...body,
      bedTime: { status: 'great', usual: '19:45', spreadMinutes: 18, nights: 26 },
      nightLength: {
        status: 'excellent',
        count: 26,
        p25Minutes: 600,
        medianMinutes: 625,
        p75Minutes: 645,
      },
    })!;
    expect(rhythm.bedTime).toMatchObject({ status: 'unknown', usual: null });
    expect(rhythm.nightLength).toMatchObject({ status: 'unknown', range: null });
  });

  it('never keeps an ok value whose numbers are missing', () => {
    const body = rhythmFixture('ok') as Record<string, unknown>;
    const rhythm = parseRhythm({
      ...body,
      wakeUp: { status: 'ok', usual: '6h35', nights: 26 },
      longestStretch: { status: 'ok', count: 26, p25Minutes: 230 },
      associations: [
        {
          factor: 'evening_feeds',
          threshold: null,
          outcomes: [
            {
              outcome: 'night_length',
              status: 'ok',
              nightsWith: 9,
              nightsWithout: 8,
              differenceMinutes: 30,
            },
          ],
        },
        {
          factor: 'dirty_diaper_day',
          outcomes: [{ outcome: 'first_stretch', status: 'ok', nightsWith: 9, nightsWithout: 8 }],
        },
        { factor: 'moon_phase', outcomes: [] },
      ],
    })!;
    expect(rhythm.wakeUp.status).toBe('unknown');
    expect(rhythm.longestStretch).toMatchObject({ status: 'unknown', range: null });
    expect(rhythm.associations).toHaveLength(2);
    expect(rhythm.associations[0].outcomes[0]).toMatchObject({
      status: 'unknown',
      differenceMinutes: null,
    });
    expect(rhythm.associations[1].outcomes[0]).toMatchObject({
      status: 'unknown',
      differenceMinutes: null,
    });
    expect(associationSentences(t, rhythm)).toEqual([]);
  });

  it('fills missing parts with not-ready metrics and the design rule', () => {
    const rhythm = parseRhythm({ bedTime: {}, nightLength: {} })!;
    expect(rhythm.bedTime).toEqual({
      status: 'unknown',
      usual: null,
      spreadMinutes: null,
      nights: 0,
    });
    expect(rhythm.naps).toMatchObject({ status: 'unknown', count: 0, usualStarts: [] });
    expect(rhythm.feeds.gap).toMatchObject({ status: 'unknown', range: null });
    expect(rhythm.associations).toEqual([]);
    expect(rhythm.rule).toEqual(DEFAULT_RHYTHM_RULE);
  });

  it('keeps the spread of a varying clock, without a usual time', () => {
    expect(parsed('varies').bedTime).toEqual({
      status: 'varies',
      usual: null,
      spreadMinutes: 104,
      nights: 26,
    });
  });
});

describe('rhythm model', () => {
  it('counts what is missing from the rule of the answer', () => {
    expect(needsMore(0, 5)).toBe(5);
    expect(needsMore(4, 5)).toBe(1);
    expect(needsMore(7, 5)).toBe(1);
    const empty = parsed('empty');
    expect(missingForClock(empty.bedTime, empty.rule)).toEqual({ unit: 'nights', count: 5 });
    const partial = parsed('partial');
    expect(missingForNights(partial.firstStretch, partial.rule)).toEqual({
      unit: 'nights',
      count: 2,
    });
    expect(missingForGap(partial.feeds.gap, partial.rule)).toEqual({ unit: 'gaps', count: 4 });
    expect(missingForNaps(partial.naps, partial.rule)).toEqual({ unit: 'days', count: 2 });
    expect(missingForNights(partial.nightLength, partial.rule)).toBeNull();
    const rule = { ...partial.rule, minimumNights: 10 };
    expect(missingForClock({ ...empty.bedTime, nights: 3 }, rule)).toEqual({
      unit: 'nights',
      count: 7,
    });
  });

  it('says a nap is missing, not days, once enough days are bracketed', () => {
    const rhythm = parsed('empty');
    expect(missingForNaps({ ...rhythm.naps, count: 6 }, rhythm.rule)).toBe('noNaps');
  });

  it('words the missing count in both languages, with plurals', async () => {
    expect(missingText(t, { unit: 'nights', count: 1 })).toBe('Needs 1 more night in the log');
    expect(missingText(t, { unit: 'nights', count: 3 })).toBe('Needs 3 more nights in the log');
    await useTestLocale('pt-BR');
    expect(missingText(t, { unit: 'nights', count: 1 })).toBe('Falta 1 noite no registro');
    expect(missingText(t, { unit: 'days', count: 2 })).toBe('Faltam 2 dias no registro');
  });

  it('builds one descriptive sentence per outcome that passed', () => {
    expect(associationSentences(t, parsed('ok'))).toEqual([
      'After days with 2 or more evening feeds, nights were usually about 40m longer (12 nights, against 10 without).',
      'After days with a dirty diaper, the longest stretch of sleep was usually about 35m shorter (15 nights, against 9 without).',
    ]);
  });

  it('builds the sentences in Portuguese with the plural forms', async () => {
    await useTestLocale('pt-BR');
    const rhythm = parsed('ok');
    const one = {
      ...rhythm,
      associations: [
        {
          ...rhythm.associations[0],
          threshold: 1,
          outcomes: [
            { ...rhythm.associations[0].outcomes[0], nightsWith: 1, differenceMinutes: 75 },
          ],
        },
      ],
    };
    expect(associationSentences(t, rhythm)).toEqual([
      'Depois de dias com 2 ou mais mamadas à noite, as noites foram em geral cerca de 40 min mais longas (12 noites, contra 10 sem).',
      'Depois de dias com fralda suja, o maior trecho de sono foi em geral cerca de 35 min mais curto (15 noites, contra 9 sem).',
    ]);
    expect(associationSentences(t, one)).toEqual([
      'Depois de dias com 1 ou mais mamadas à noite, as noites foram em geral cerca de 1 h 15 min mais longas (1 noite, contra 10 sem).',
    ]);
  });

  it('tells no clear difference apart from too few nights', () => {
    expect(comparisonState(parsed('ok'))).toBe('sentences');
    expect(comparisonState(parsed('varies'))).toBe('noClearDifference');
    expect(comparisonState(parsed('partial'))).toBe('notEnough');
    expect(comparisonState(parsed('empty'))).toBe('notEnough');
  });

  it('says how much a varying time spreads', () => {
    const rhythm = parsed('varies');
    expect(variesText(t, rhythm.bedTime)).toBe('Times spread by about 1h 44m over 26 nights');
    expect(variesText(t, { ...rhythm.bedTime, spreadMinutes: null, nights: 1 })).toBe(
      'Times vary over 1 night',
    );
  });
});

function rhythmApi(answer: unknown | ((call: ApiCall) => unknown)) {
  return fakeApi((call: ApiCall) => {
    if (call.path.includes('/measurements')) return [];
    if (call.path.includes('/rhythm')) return typeof answer === 'function' ? answer(call) : answer;
    return undefined;
  });
}

function renderSection(answer: unknown | ((call: ApiCall) => unknown)) {
  const fake = rhythmApi(answer);
  const view = renderWithDb(db, <RhythmSection babyId="baby-1" babyName="Lia" />, {
    api: fake.api,
  });
  return { ...fake, ...view };
}

const section = () => screen.findByRole('region', { name: /^(Lia's rhythm|Ritmo de Lia)$/ });

describe('RhythmSection', () => {
  it('shows the four cards in order with the usual times, ranges and sentences', async () => {
    const { calls } = renderSection(rhythmFixture('ok'));
    const region = await section();
    await within(region).findByText('around 19:45');
    const titles = within(region)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(titles).toEqual(['Sleep', 'Naps', 'Feeds', 'What the log shows']);
    expect(within(region).getByText('around 06:35')).toBeTruthy();
    expect(within(region).getByText('10h to 10h 45m')).toBeTruthy();
    expect(within(region).getByText('median 10h 25m')).toBeTruthy();
    expect(within(region).getByText('3 to 3.5')).toBeTruthy();
    expect(within(region).getByText('around 09:05')).toBeTruthy();
    expect(within(region).getByText('2h 30m to 3h 15m')).toBeTruthy();
    expect(
      within(region).getByText(
        /^After days with 2 or more evening feeds, nights were usually about 40m longer/,
      ),
    ).toBeTruthy();
    const call = calls.find((c) => c.path.includes('/rhythm'))!;
    expect(call.path).toMatch(/^\/api\/v1\/babies\/baby-1\/rhythm\?utcOffsetMinutes=-?\d+/);
  });

  it('lists the rule values under "How this is worked out"', async () => {
    renderSection(rhythmFixture('ok'));
    const region = await section();
    const toggle = await within(region).findByRole('button', { name: 'How this is worked out' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(region).getByText(/last 28 days of this baby's own log only/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      await within(region).findByText(
        /needs 7 nights on each side and a difference of at least 20m/,
      ),
    ).toBeTruthy();
    expect(within(region).getByText(/spread by more than 1h 30m/)).toBeTruthy();
  });

  it('says what each metric still needs, and one calm line for the comparisons', async () => {
    renderSection(rhythmFixture('empty'));
    const region = await section();
    expect(await within(region).findAllByText('Needs 5 more nights in the log')).toHaveLength(5);
    expect(within(region).getAllByText('Needs 5 more days in the log')).toHaveLength(2);
    expect(within(region).getByText('Needs 10 more gaps between feeds in the log')).toBeTruthy();
    expect(within(region).getByText('Not enough nights to compare yet.')).toBeTruthy();
    expect(within(region).getByText('Each side needs 7 nights. So far:')).toBeTruthy();
    expect(
      within(region).getByText('0 nights after more evening feeds, 0 after fewer'),
    ).toBeTruthy();
    expect(within(region).getByText('No regular start time in the log yet.')).toBeTruthy();
  });

  it('shows "Varies" with the spread, and no clear difference', async () => {
    renderSection(rhythmFixture('varies'));
    const region = await section();
    expect(await within(region).findAllByText('Varies')).toHaveLength(2);
    expect(within(region).getByText('Times spread by about 1h 44m over 26 nights')).toBeTruthy();
    expect(
      within(region).getByText('No clear difference between the nights in the log yet.'),
    ).toBeTruthy();
    expect(within(region).queryByText(/around 19/)).toBeNull();
  });

  it('shows a loading skeleton first', async () => {
    renderSection(() => new Promise(() => undefined));
    const region = await section();
    expect(within(region).getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows a muted line on error, and reloads', async () => {
    let fail = true;
    renderSection(() => {
      if (fail) throw httpError(500);
      return rhythmFixture('ok');
    });
    const region = await section();
    await within(region).findByText('The rhythm could not be loaded right now.');
    fail = false;
    fireEvent.click(within(region).getByRole('button', { name: 'Reload' }));
    expect(await within(region).findByText('around 19:45')).toBeTruthy();
  });

  it.each([403, 404])('hides the section on %i', async (status) => {
    const { calls } = renderSection(() => {
      throw httpError(status);
    });
    await waitFor(() => expect(calls.some((c) => c.path.includes('/rhythm'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('region', { name: /rhythm/ })).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offline with nothing cached shows a muted line and asks nothing', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { calls } = renderSection(rhythmFixture('ok'));
    const region = await section();
    expect(within(region).getByText('Connect to see the rhythm.')).toBeTruthy();
    expect(calls.some((c) => c.path.includes('/rhythm'))).toBe(false);
  });

  it('stores nothing on the device', async () => {
    const before = { ...window.localStorage };
    renderSection(rhythmFixture('ok'));
    await within(await section()).findByText('around 19:45');
    expect({ ...window.localStorage }).toEqual(before);
    expect(await db.outbox.count()).toBe(0);
  });

  it('appears in Insights under the selected baby', async () => {
    await seedBaby(db);
    renderWithDb(db, <InsightsPage />, { api: rhythmApi(rhythmFixture('ok')).api });
    const region = await section();
    expect(await within(region).findByText('around 19:45')).toBeTruthy();
  });
});

describe('no causal or judging words', () => {
  const strings = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];

  it.each([
    ['en', enRhythm],
    ['pt-BR', ptRhythm],
  ] as const)('in the %s catalog', (locale, catalog) => {
    const offending = strings(catalog).filter((s) => FORBIDDEN[locale].test(s));
    expect(offending).toEqual([]);
  });

  it.each(['en', 'pt-BR'] as const)('in every rendered scenario, %s', async (locale) => {
    await useTestLocale(locale);
    for (const scenario of RHYTHM_SCENARIOS) {
      const view = renderSection(rhythmFixture(scenario));
      const region = await section();
      await waitFor(() => expect(within(region).queryByRole('status')).toBeNull());
      fireEvent.click(
        within(region).getByRole('button', {
          name: /^(How this is worked out|Como isto é calculado)$/,
        }),
      );
      const text = region.textContent ?? '';
      expect(text.length).toBeGreaterThan(100);
      expect(FORBIDDEN[locale].exec(text)?.[0] ?? null).toBeNull();
      view.unmount();
    }
  });
});

describe.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['night', 'pt-BR'],
] as const)('the rhythm in the %s scheme, %s', (scheme, locale) => {
  it.each(['ok', 'empty'] as const)('has no accessibility violations (%s)', async (scenario) => {
    if (scheme === 'night') {
      window.localStorage.setItem(
        NIGHT_FEED_STATE_STORAGE_KEY,
        JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
      );
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
    }
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    await useTestLocale(locale);
    const { container } = renderSection(rhythmFixture(scenario));
    const region = await section();
    await waitFor(() => expect(within(region).queryByRole('status')).toBeNull());
    fireEvent.click(
      within(region).getByRole('button', {
        name: /^(How this is worked out|Como isto é calculado)$/,
      }),
    );
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
