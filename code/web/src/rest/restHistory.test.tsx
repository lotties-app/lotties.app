import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import enRest from '../i18n/locales/en/rest.json';
import ptRest from '../i18n/locales/pt-BR/rest.json';
import { formatDate, formatDuration } from '../i18n/format';
import { InsightsPage } from '../pages/InsightsPage';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import {
  DEFAULT_REST_SETTINGS,
  parseRestHistory,
  type RestEstimate,
  type RestHistory,
  type RestHistoryNight,
  type RestSettings,
} from './restApi';
import { HISTORY_NIGHTS_KEY, nightAxis, readHistoryNights, spanOnAxis } from './restHistoryModel';
import { restHistoryFixture } from './restHistoryFixtures';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  try {
    window.localStorage.removeItem(HISTORY_NIGHTS_KEY);
  } catch {
    /* ignore */
  }
});

afterEach(async () => {
  await settleSync();
  await db.delete();
  vi.restoreAllMocks();
});

const ON: RestSettings = { ...DEFAULT_REST_SETTINGS, enabled: true, timeZone: 'America/Sao_Paulo' };

const ESTIMATE: RestEstimate = {
  night: '2026-01-10',
  status: 'ok',
  parts: [],
  askMorning: false,
  constants: { fallAsleepMinutes: 20, wakeLeadMinutes: 20 },
};

type HistoryAnswer = RestHistory | ((call: ApiCall) => unknown);

function historyApi(history: HistoryAnswer) {
  return fakeApi((call: ApiCall) => {
    if (call.path.includes('/measurements')) return [];
    if (call.path === '/api/v1/me/rest-settings') return ON;
    if (call.path.startsWith('/api/v1/me/rest/history')) {
      return typeof history === 'function' ? history(call) : history;
    }
    if (call.path.startsWith('/api/v1/me/rest')) return ESTIMATE;
    return undefined;
  });
}

async function renderHistory(history: HistoryAnswer) {
  await seedBaby(db);
  const fake = historyApi(history);
  renderWithDb(db, <InsightsPage />, { api: fake.api });
  fireEvent.click(await screen.findByRole('tab', { name: /^(Rest|Descanso)$/ }));
  return fake;
}

const historySection = async () => screen.findByRole('region', { name: /^(History|Histórico)$/ });

describe('Rest history', () => {
  it('draws the nights newest first, with notes in words and the accessible tables', async () => {
    const { calls } = await renderHistory(restHistoryFixture('ok'));
    const section = await historySection();
    await within(section).findByTestId('rest-history-nights-chart');
    expect(calls.some((c) => c.path === '/api/v1/me/rest/history?nights=14')).toBe(true);

    const rows = within(section).getAllByTestId('rest-history-night');
    expect(rows).toHaveLength(restHistoryFixture('ok').nights.length);
    expect(
      within(section).getAllByText('Overlaps your work hours, not in the typical values').length,
    ).toBeGreaterThan(0);
    expect(within(section).getAllByText('Not enough in the log').length).toBeGreaterThan(0);
    expect(within(section).getByText('Low confidence')).toBeTruthy();
    expect(
      within(section).getByText("Estimated from the baby's log, not a measurement."),
    ).toBeTruthy();

    const table = within(section).getByRole('table', { name: 'Estimated rest per night' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    // Newest first, like the Day list.
    expect(bodyRows[0].textContent).toContain(formatDate('2026-01-10', 'weekdayDayMonth'));
    expect(bodyRows[bodyRows.length - 1].textContent).toContain(
      formatDate('2025-12-28', 'weekdayDayMonth'),
    );
    expect(within(section).getByRole('table', { name: 'Typical rested time' })).toBeTruthy();
    expect(
      within(section).getByRole('table', {
        name: 'Share of counted nights estimated asleep, by hour',
      }),
    ).toBeTruthy();
  });

  it('shows typical rested time as "about" ranges with counts, and the typical night', async () => {
    const fixture = restHistoryFixture('ok');
    await renderHistory(fixture);
    const section = await historySection();
    const weekday = await within(section).findByTestId('rest-history-weekday');
    const minutes = fixture.weekdayWeekend.weekday.restedMinutes!;
    const text = (m: number) => formatDuration(m * 60_000);
    expect(within(weekday).getByText(`about ${text(minutes.median)}`)).toBeTruthy();
    expect(
      within(weekday).getByText(`usually about ${text(minutes.p25)} to ${text(minutes.p75)}`),
    ).toBeTruthy();
    expect(
      within(weekday).getByText(`${fixture.weekdayWeekend.weekday.countedNights} nights`),
    ).toBeTruthy();
    expect(within(section).getByTestId('rest-history-weekend')).toBeTruthy();
    expect(within(section).queryByText(/Not enough nights yet/)).toBeNull();
    // 24 hour cells and their 24 (mostly hidden) labels.
    expect(within(section).getByTestId('rest-history-typical-night').children.length).toBe(48);
    expect(
      within(section).getByText('How often you are estimated to be asleep at each hour'),
    ).toBeTruthy();
  });

  it('draws no summary chart below the minimum', async () => {
    await renderHistory(restHistoryFixture('belowMinimum'));
    const section = await historySection();
    await within(section).findByTestId('rest-history-nights-chart');
    expect(within(section).getAllByText('Not enough nights yet (needs 4)')).toHaveLength(3);
    expect(within(section).queryByTestId('rest-history-typical-night')).toBeNull();
    expect(within(section).queryByRole('table', { name: 'Typical rested time' })).toBeNull();
    expect(within(section).getByText('3 nights')).toBeTruthy();
    const weekend = within(section).getByTestId('rest-history-weekend');
    expect(within(weekend).getByText('1 night')).toBeTruthy();
    expect(within(weekend).getByText('Not enough nights yet (needs 4)')).toBeTruthy();
  });

  it('says when no night has an estimate', async () => {
    await renderHistory(restHistoryFixture('notEnoughLog'));
    const section = await historySection();
    expect(
      await within(section).findByText('No night in this period has an estimate yet.'),
    ).toBeTruthy();
    expect(within(section).queryByTestId('rest-history-nights-chart')).toBeNull();
  });

  it('says the estimate is off when the server answers disabled', async () => {
    await renderHistory(restHistoryFixture('disabled'));
    const section = await historySection();
    expect(await within(section).findByText('The rest estimate is turned off.')).toBeTruthy();
    expect(within(section).queryByTestId('rest-history-nights-chart')).toBeNull();
  });

  it('refetches with 28 nights and remembers the choice', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { calls } = await renderHistory(restHistoryFixture('ok'));
    const section = await historySection();
    await within(section).findByTestId('rest-history-nights-chart');
    expect(setItem.mock.calls.filter(([key]) => key === HISTORY_NIGHTS_KEY)).toEqual([]);
    fireEvent.click(within(section).getByRole('radio', { name: '28 nights' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/v1/me/rest/history?nights=28')).toBe(true),
    );
    expect(window.localStorage.getItem(HISTORY_NIGHTS_KEY)).toBe('28');
    expect(readHistoryNights()).toBe(28);
    expect(
      within(section).getByRole('radio', { name: '28 nights' }).getAttribute('aria-checked'),
    ).toBe('true');
    // Only the choice is stored: never a night, a part or a summary.
    const values = setItem.mock.calls.map(([, value]) => value).join(' ');
    expect(values).not.toMatch(/parts|night|median|share/);
  });

  it('keeps the last answer when the connection drops and says so', async () => {
    await renderHistory(restHistoryFixture('ok'));
    const section = await historySection();
    await within(section).findByTestId('rest-history-nights-chart');
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      window.dispatchEvent(new Event('offline'));
      expect(await within(section).findByText(/Shown from your last connection/)).toBeTruthy();
      expect(within(section).getByTestId('rest-history-nights-chart')).toBeTruthy();
    } finally {
      spy.mockRestore();
      window.dispatchEvent(new Event('online'));
    }
  });

  it('shows an error with a way to retry', async () => {
    await renderHistory(() => {
      throw httpError(500);
    });
    const section = await historySection();
    expect(await within(section).findByText('The history could not be loaded.')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('shows no section when the server does not know the route', async () => {
    const { calls } = await renderHistory(() => {
      throw httpError(404);
    });
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/api/v1/me/rest/history'))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('region', { name: 'History' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Your rest settings' })).toBeTruthy();
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    await renderHistory(restHistoryFixture('belowMinimum'));
    const section = await historySection();
    expect(
      await within(section).findByRole('heading', { name: 'Tempo de descanso típico' }),
    ).toBeTruthy();
    expect(within(section).getByRole('radio', { name: '28 noites' })).toBeTruthy();
    expect(
      within(section).getAllByText('Ainda não há noites suficientes (são necessárias 4)'),
    ).toHaveLength(3);
  });
});

describe('Rest history strings', () => {
  const strings = (node: unknown): string[] =>
    typeof node === 'string'
      ? [node]
      : node && typeof node === 'object'
        ? Object.values(node).flatMap(strings)
        : [];

  it('never judge, score or compare (en)', () => {
    const text = strings(enRest.rest.history).join('\n');
    expect(text).not.toMatch(
      /\b(better|worse|best|worst|score|target|goal|good|bad|poor|healthy|unhealthy|normal|abnormal|should|ideal|deficit|debt|too (little|much|few|short|long)|partner|family|compared?)\b/i,
    );
  });

  it('never judge, score or compare (pt-BR)', () => {
    const text = strings(ptRest.rest.history).join('\n');
    expect(text).not.toMatch(
      /\b(melhor|pior|pontuação|nota|meta|objetivo|bom|boa|ruim|saudável|normal|anormal|deveria|ideal|déficit|dívida|pouco demais|demais|parceiro|parceira|família|compar\w*)\b/i,
    );
  });

  it('have the same keys in both languages', () => {
    const keys = (node: unknown, prefix = ''): string[] =>
      node && typeof node === 'object'
        ? Object.entries(node).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    expect(keys(ptRest.rest.history).sort()).toEqual(keys(enRest.rest.history).sort());
  });
});

describe('restHistoryModel', () => {
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 0, day, hour, minute).toISOString();
  const night = (date: string, parts: [string, string][]): RestHistoryNight => ({
    night: date,
    status: 'ok',
    parts: parts.map(([start, end]) => ({
      start,
      end,
      startSource: 'babyLog',
      endSource: 'ownEvent',
      confidence: 'normal',
    })),
    confidence: 'normal',
    workOverlap: false,
    counted: true,
  });

  it('shares one axis of whole hours across nights', () => {
    const axis = nightAxis([
      night('2026-01-05', [[at(5, 21, 20), at(6, 6, 30)]]),
      night('2026-01-06', [[at(6, 22, 0), at(7, 7, 10)]]),
    ]);
    expect(axis).toEqual({ start: 21, end: 33, ticks: [21, 24, 27, 30, 33] });
    const span = spanOnAxis(axis!, '2026-01-06', at(6, 22, 0), at(7, 7, 10));
    expect(span.left).toBeCloseTo((1 / 12) * 100);
    expect(span.width).toBeCloseTo(((9 + 1 / 6) / 12) * 100);
    expect(nightAxis([{ ...night('2026-01-05', []), status: 'notEnoughLog' }])).toBeNull();
  });

  it('parses only the contract shape', () => {
    expect(parseRestHistory([])).toBeNull();
    expect(parseRestHistory({ night: '2026-01-01', status: 'ok', parts: [] })).toBeNull();
    const parsed = parseRestHistory(restHistoryFixture('ok'));
    expect(parsed?.nights).toHaveLength(14);
    expect(parsed?.constants.minimumNights).toBe(4);
  });

  it('falls back to 14 nights when nothing valid is stored', () => {
    window.localStorage.setItem(HISTORY_NIGHTS_KEY, '7');
    expect(readHistoryNights()).toBe(14);
  });
});
