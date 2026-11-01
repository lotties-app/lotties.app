import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siriBridge } from '../assistants/siriBridge';
import type { BabyRoutineDb } from '../db/database';
import { testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { SiriConnectPanel } from './SiriConnectPanel';

/* Settings > Voice assistants > Siri and Shortcuts: connect and disconnect the iPhone's Siri intents. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

const URL = 'https://lotties.test/api/v1/mcp';
const AUTHORITY = 'https://auth.test/realms/lotties.app';

describe('SiriConnectPanel', () => {
  it('connects through the native sign-in and then offers to disconnect', async () => {
    let connected = false;
    vi.spyOn(siriBridge, 'status').mockImplementation(() => Promise.resolve(connected));
    const connect = vi.spyOn(siriBridge, 'connect').mockImplementation(() => {
      connected = true;
      return Promise.resolve(true);
    });
    renderWithDb(db, <SiriConnectPanel url={URL} authority={AUTHORITY} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Siri' }));

    expect(await screen.findByRole('button', { name: 'Disconnect Siri' })).toBeTruthy();
    expect(connect).toHaveBeenCalledWith(AUTHORITY, URL);
  });

  it('says so when the sign-in fails', async () => {
    vi.spyOn(siriBridge, 'status').mockResolvedValue(false);
    vi.spyOn(siriBridge, 'connect').mockRejectedValue(new Error('no'));
    renderWithDb(db, <SiriConnectPanel url={URL} authority={AUTHORITY} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Siri' }));

    await waitFor(() =>
      expect(screen.getByText('Could not connect Siri. Try again.')).toBeTruthy(),
    );
  });
});
