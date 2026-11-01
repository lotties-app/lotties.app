import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { BabyRoutineDb } from '../db/database';
import { enqueueMutation } from '../db/outbox';
import type { BabyRole } from '../db/models';
import {
  BABY_ID,
  fakeApi,
  httpError,
  networkError,
  testDatabase,
  type ApiCall,
} from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { ExportSection } from './ExportSection';

let db: BabyRoutineDb;
let downloads: { name: string; href: string }[];

beforeEach(() => {
  db = testDatabase();
  downloads = [];
  URL.createObjectURL = vi.fn(() => 'blob:backup');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, href: this.href });
  });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const EXPORT_PATH = `/api/v1/babies/${BABY_ID}/export`;

function Host() {
  const { baby } = useSelectedBaby();
  return baby ? <ExportSection baby={baby} /> : null;
}

async function setup(handler: (call: ApiCall) => unknown, role: BabyRole = 'Owner') {
  await seedBaby(db, { role });
  const fake = fakeApi(handler);
  renderWithDb(db, <Host />, { api: fake.api });
  return fake;
}

const file = () => new Blob(['backup'], { type: 'application/gzip' });
const exportCalls = (calls: ApiCall[]) => calls.filter((call) => call.path.startsWith(EXPORT_PATH));

describe('Export data', () => {
  it('tells a Viewer that only owners and parents can export', async () => {
    await setup(() => undefined, 'Viewer');
    expect(
      await screen.findByText("Only owners and parents can export a baby's data."),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export data' })).toBeNull();
  });

  it('explains what the file holds and that it is health data to keep safe', async () => {
    await setup(() => undefined);
    expect(await screen.findByText(/holds your child.s health data/)).toBeTruthy();
    expect(screen.getByText(/Not included: other members, invites/)).toBeTruthy();
  });

  it('downloads the compressed backup after sending what is waiting', async () => {
    const { calls } = await setup((call) =>
      call.path.startsWith(EXPORT_PATH) ? file() : undefined,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Export data' }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/^lotties-backup-lia-\d{8}\.json\.gz$/);
    expect(downloads[0].href).toBe('blob:backup');
    expect(exportCalls(calls)).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: `${EXPORT_PATH}?compress=true`,
        responseType: 'blob',
      }),
    ]);
    // The device was synced first.
    expect(calls.findIndex((call) => call.path === '/api/v1/babies')).toBeLessThan(
      calls.findIndex((call) => call.path.startsWith(EXPORT_PATH)),
    );
    expect(await screen.findByText(/Saved lotties-backup-lia-\d{8}\.json\.gz/)).toBeTruthy();
  });

  it('can write the plain, readable file', async () => {
    const { calls } = await setup((call) =>
      call.path.startsWith(EXPORT_PATH) ? file() : undefined,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: /Compress the file/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export data' }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/\.json$/);
    expect(exportCalls(calls)[0].path).toBe(`${EXPORT_PATH}?compress=false`);
  });

  it('warns about changes that could not be sent, and exports without them only when asked', async () => {
    await seedBaby(db);
    await enqueueMutation(db, {
      babyId: BABY_ID,
      kind: 'upsert',
      entityType: 'event',
      entityId: 'e-1',
      payload: { typeId: 'type-feeding', startedAt: '2026-10-20T08:00:00.000Z' },
      createdAt: '2026-10-20T08:00:00.000Z',
    });
    const fake = fakeApi((call) => {
      if (call.method === 'PUT') throw networkError();
      return call.path.startsWith(EXPORT_PATH) ? file() : undefined;
    });
    renderWithDb(db, <Host />, { api: fake.api });

    fireEvent.click(await screen.findByRole('button', { name: 'Export data' }));
    expect(
      await screen.findByText(
        /Not everything on this device could be sent first \(1 unsynced change\)/,
      ),
    ).toBeTruthy();
    expect(exportCalls(fake.calls)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Export anyway' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(exportCalls(fake.calls)).toHaveLength(1);
  });

  it('shows why an export failed and downloads nothing', async () => {
    await setup((call) => {
      if (call.path.startsWith(EXPORT_PATH)) throw httpError(403);
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Export data' }));

    expect(await screen.findByText('You do not have permission to do this.')).toBeTruthy();
    expect(downloads).toHaveLength(0);
  });
});
