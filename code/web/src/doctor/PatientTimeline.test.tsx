import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { EventDto } from '../sync/contract';
import { DIAPER_DTO, FEEDING_DTO, SLEEP_DTO } from '../test/builtInTypes';
import { testDatabase, type ApiHandler } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { settleSync } from '../test/renderApp';
import { lastQuery, patientBaby, renderDashboard } from './dashboardTestKit';

/* The doctor's timeline (docs/design/19-doctor-dashboard.md section 5.3): one day from the server. */

let db: BabyRoutineDb;

const LIA = patientBaby('lia', 'Lia', '2026-08-01');
const BIA = patientBaby('bia', 'Bia', '2026-08-01', ['notes']);

const at = (day: Date, hours: number, minutes = 0) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).toISOString();

function event(
  id: string,
  typeId: string,
  startedAt: string,
  payload: Record<string, unknown>,
): EventDto {
  return {
    id,
    babyId: 'lia',
    typeId,
    startedAt,
    endedAt: startedAt,
    payload,
    notes: null,
    createdBy: 'mom',
    createdAt: startedAt,
    updatedAt: startedAt,
    clientUpdatedAt: startedAt,
    deletedAt: null,
  };
}

const day = new Date(2026, 9, 20);

const handler: ApiHandler = (call) => {
  const path = call.path.split('?')[0];
  if (path.endsWith('/event-types')) return [FEEDING_DTO, SLEEP_DTO, DIAPER_DTO];
  if (path.endsWith('/timeline')) {
    return [
      event('d1', DIAPER_DTO.id, at(day, 7, 10), { content: 'WET' }),
      event('f1', FEEDING_DTO.id, at(day, 9, 30), { method: 'bottle', amount_ml: 120 }),
    ];
  }
  return undefined;
};

beforeEach(() => {
  db = testDatabase();
  window.localStorage.clear();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

describe('patient timeline', () => {
  it("reads the day's entries from the server, read-only", async () => {
    const { calls } = await renderDashboard(
      db,
      '/doctor/lia/timeline?day=2026-10-20',
      [LIA],
      handler,
    );

    expect(await screen.findByRole('heading', { name: 'Timeline', level: 1 })).toBeTruthy();
    expect(screen.getByText("Read only: these are the family's entries.")).toBeTruthy();
    const list = await screen.findByRole('list', { name: /20/ });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const button of within(list).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    // Appointments are never a doctor's: no calendar link in her timeline.
    expect(screen.queryByRole('link', { name: /appointments/i })).toBeNull();

    const query = lastQuery(calls, '/timeline');
    expect(query.get('from')).toBe(new Date(2026, 9, 19).toISOString());
    expect(query.get('to')).toBe(new Date(2026, 9, 21).toISOString());
    expect(calls.some((call) => call.path.includes('/events'))).toBe(false);
  });

  it('moves to the previous day and keeps it in the URL', async () => {
    const { calls } = await renderDashboard(
      db,
      '/doctor/lia/timeline?day=2026-10-20',
      [LIA],
      handler,
    );
    await screen.findByRole('list', { name: /20/ });

    fireEvent.click(screen.getByRole('button', { name: /^Previous week$/ }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/doctor/lia/timeline?day=2026-10-13',
      ),
    );
    await waitFor(() =>
      expect(lastQuery(calls, '/timeline').get('from')).toBe(new Date(2026, 9, 12).toISOString()),
    );
  });

  it('is not shared without the daily log, and asks the server nothing', async () => {
    const { calls } = await renderDashboard(db, '/doctor/bia/timeline', [BIA], handler);

    expect(await screen.findByRole('heading', { name: 'Timeline', level: 1 })).toBeTruthy();
    expect(screen.getByText('Not shared with you')).toBeTruthy();
    expect(screen.getByText(/The family did not share daily log/)).toBeTruthy();
    expect(calls.some((call) => call.path.includes('/timeline'))).toBe(false);
    expect(calls.some((call) => call.path.includes('/event-types'))).toBe(false);
  });

  it('reads in pt-BR', async () => {
    await useTestLocale('pt-BR');
    await renderDashboard(db, '/doctor/bia/timeline', [BIA], handler);

    expect(await screen.findByRole('heading', { name: 'Linha do tempo', level: 1 })).toBeTruthy();
    expect(screen.getByText(/A família não compartilhou diário/)).toBeTruthy();
  });
});
