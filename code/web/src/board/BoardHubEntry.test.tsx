import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { isEntryVisible, type HubContext } from '../hub/hubEntries';
import { HubPage } from '../pages/HubPage';
import { MEMBERS, seedFamily } from '../proposals/proposalKit';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { fakeBoardServer, ROLE_ME, type BoardAccessMode } from './boardTestKit';

/*
 * The Hub's "Project board" entry (docs/design/21-hub.md): shown only when GET /board/me grants
 * read access, asked in the background (the Hub never waits for it), never for a Doctor without a
 * family of her own, never in the native app.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  await settleSync();
  await db.delete();
});

async function renderHub(access: BoardAccessMode | 'pending', role: BabyRole = 'Owner') {
  await seedFamily(db, role);
  const board = fakeBoardServer({ access: access === 'pending' ? 'forbidden' : access });
  const fake = fakeApi((call) => {
    if (call.path.endsWith('/members')) return MEMBERS;
    if (call.path.includes('/board/') && access === 'pending') return new Promise(() => {});
    return board.handler(call);
  });
  renderWithDb(db, <HubPage />, { api: fake.api, route: '/hub' });
  await screen.findByRole('heading', { name: 'Hub', level: 1 });
  return fake;
}

const boardRow = () => screen.queryByTestId('hub-row-board');
const meCalls = (fake: ReturnType<typeof fakeApi>) =>
  fake.calls.filter((call) => call.path === '/api/v1/board/me');

describe('the Project board entry', () => {
  it.each(['reader', 'writer', 'admin'] as const)(
    'appears in App for a board %s, linking to /hub/board',
    async (role) => {
      const fake = await renderHub(ROLE_ME[role]);
      const row = await screen.findByTestId('hub-row-board');
      expect(row.getAttribute('href')).toBe('/hub/board');
      expect(row.textContent).toContain('Project board');
      // Asked once, without the login redirect of a 401.
      expect(meCalls(fake)).toHaveLength(1);
      expect(meCalls(fake)[0].skipUnauthorizedHandler).toBe(true);
    },
  );

  it.each([
    ['without a board role (403)', 'forbidden'],
    ['while the board is disabled (404)', 'disabled'],
  ] as const)('stays hidden %s', async (_, access) => {
    const fake = await renderHub(access);
    await waitFor(() => expect(meCalls(fake)).toHaveLength(1));
    await screen.findByTestId('hub-row-about');
    expect(boardRow()).toBeNull();
  });

  it('never makes the Hub wait for the answer', async () => {
    await renderHub('pending');
    expect(await screen.findByTestId('hub-row-settings')).toBeTruthy();
    expect(boardRow()).toBeNull();
  });

  it('is not offered to a Doctor in her patients’ Hub', async () => {
    await renderHub(ROLE_ME.admin, 'Doctor');
    await screen.findByTestId('hub-row-patients');
    expect(boardRow()).toBeNull();
  });

  it('is not in the native app, which does not even ask', async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const fake = await renderHub(ROLE_ME.admin);
    await screen.findByTestId('hub-row-about');
    expect(boardRow()).toBeNull();
    expect(meCalls(fake)).toHaveLength(0);
  });

  it('follows the visibility rule', () => {
    const base: HubContext = {
      baby: undefined,
      hasPatients: false,
      hasDoctorContent: false,
      native: false,
      installed: false,
    };
    expect(isEntryVisible('board', base)).toBe(false);
    expect(isEntryVisible('board', { ...base, board: true })).toBe(true);
    expect(isEntryVisible('board', { ...base, board: true, native: true })).toBe(false);
    expect(isEntryVisible('board', { ...base, board: true, hasPatients: true })).toBe(false);
  });
});
