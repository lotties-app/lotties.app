import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import type { PredictionDto, PredictionsDto } from '../sync/contract';
import { BABY_ID, fakeApi, httpError, testDatabase, type ApiHandler } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { renderWithDb, type RenderOptions } from '../test/renderApp';
import { EVENT_TYPES } from '../test/seed';
import { clockWithDay } from './predictionModel';
import { writeCachedPredictions } from './predictionsCache';
import { PredictionsSection } from './PredictionsSection';

const BABY: Baby = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const HOUR = 3_600_000;

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

function prediction(overrides: Partial<PredictionDto> = {}): PredictionDto {
  return {
    typeKey: 'feeding',
    nextStart: { earliest: inHours(1), expected: inHours(1.5), latest: inHours(2) },
    expectedDuration: { minutes: 25, sampleCount: 9 },
    confidence: 'High',
    sampleCount: 12,
    reason: 'Feeds started every 3 h (median) over the last 14 days.',
    basis: {},
    ...overrides,
  };
}

function response(overrides: Partial<PredictionsDto> = {}): PredictionsDto {
  return {
    babyId: BABY_ID,
    generatedAt: new Date().toISOString(),
    predictions: [prediction()],
    insufficientData: [{ typeKey: 'diaper', sampleCount: 1, requiredSamples: 3, reason: 'few' }],
    ...overrides,
  };
}

function renderSection(handler: ApiHandler, options: Omit<RenderOptions, 'api'> = {}) {
  const fake = fakeApi(handler);
  renderWithDb(db, <PredictionsSection baby={BABY} types={EVENT_TYPES} />, {
    ...options,
    api: fake.api,
  });
  return fake;
}

const predictionCalls = (calls: { path: string }[]) =>
  calls.filter((c) => c.path.includes('/predictions'));

describe('PredictionsSection', () => {
  it('fetches with the local UTC offset and renders a card per prediction', async () => {
    const data = response();
    const { calls } = renderSection(() => data);

    const card = await screen.findByRole('article', { name: 'Next Feeding' });
    const expected = data.predictions[0].nextStart;
    expect(
      within(card).getByText(
        `around ${clockWithDay(expected.expected, new Date())}, between ` +
          `${clockWithDay(expected.earliest, new Date())} and ${clockWithDay(expected.latest, new Date())}` +
          '; usually lasts 25m',
      ),
    ).toBeTruthy();
    expect(within(card).getByText('High confidence')).toBeTruthy();
    expect(within(card).queryByText('Overdue')).toBeNull();
    expect(screen.getByText('Need more data for: Diaper')).toBeTruthy();
    expect(screen.getByText(/not medical advice/)).toBeTruthy();

    const offset = -new Date().getTimezoneOffset() || 0;
    expect(predictionCalls(calls).map((c) => c.path)).toEqual([
      `/api/v1/babies/${BABY_ID}/predictions?utcOffsetMinutes=${offset}`,
    ]);
  });

  it('reveals the reason on "Why?"', async () => {
    renderSection(() => response());

    const why = await screen.findByRole('button', { name: 'Why?' });
    expect(why.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(why);

    expect(why.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Feeds started every 3 h/)).toBeTruthy();
  });

  it('marks a prediction whose expected time has passed as overdue', async () => {
    const late = prediction({
      nextStart: { earliest: inHours(-2), expected: inHours(-1), latest: inHours(1) },
    });
    renderSection(() => response({ predictions: [late] }));

    const card = await screen.findByRole('article', { name: 'Next Feeding' });
    expect(within(card).getByText('Overdue')).toBeTruthy();
  });

  it('shows the cached result offline with a last-updated label, without fetching', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchedAt = Date.now() - 10 * 60_000;
    writeCachedPredictions(BABY_ID, { data: response(), fetchedAt });
    const { calls } = renderSection(() => response());

    expect(await screen.findByRole('article', { name: 'Next Feeding' })).toBeTruthy();
    const when = clockWithDay(new Date(fetchedAt).toISOString(), new Date());
    expect(screen.getByText(`Offline · Last updated ${when}`)).toBeTruthy();
    expect(predictionCalls(calls)).toHaveLength(0);
  });

  it('explains when offline without a cached result', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderSection(() => response());

    expect(await screen.findByText('Predictions load when you are back online.')).toBeTruthy();
  });

  it('does not fetch while signed out', async () => {
    const { calls } = renderSection(() => response(), {
      auth: fakeAuth({ isAuthenticated: false }),
    });

    expect(await screen.findByText('Loading predictions…')).toBeTruthy();
    expect(predictionCalls(calls)).toHaveLength(0);
  });

  it('reports a failed fetch', async () => {
    renderSection((call) => {
      if (call.path.includes('/predictions')) throw httpError(500);
    });

    await waitFor(() =>
      expect(screen.getByText('Predictions are unavailable right now.')).toBeTruthy(),
    );
  });
});
