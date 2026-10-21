import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dexie from 'dexie';
import { useContext, useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import { readSelectedBabyId, writeSelectedBabyId } from '../baby/selectedBabyStorage';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseContext } from '../db/DatabaseContext';
import { createEvent } from '../db/eventCommands';
import { UserMenu } from '../layout/UserMenu';
import { readCachedPredictions, writeCachedPredictions } from '../predictions/predictionsCache';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { BABY_ID, TYPE_ID, fakeApi, networkError } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { AccountDataProvider } from './AccountDataProvider';
import { accountDatabaseName, LEGACY_DATABASE_NAME } from './accountDatabase';
import { sha256Hex } from './sha256';

const ANA = 'https://issuer.test|ana';
const BIA = 'https://issuer.test|bia';

afterEach(async () => {
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

describe('account database name', () => {
  it('is BabyRoutineDb- plus 16 hex chars of SHA-256(issuer|sub)', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    for (const text of ['', 'ação|sub', 'x'.repeat(1000)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
    expect(accountDatabaseName(ANA)).toBe(`BabyRoutineDb-${sha256Hex(ANA).slice(0, 16)}`);
    expect(accountDatabaseName(ANA)).not.toBe(accountDatabaseName(BIA));
    expect(accountDatabaseName('https://other.test|ana')).not.toBe(accountDatabaseName(ANA));
  });
});

const captured: { db: BabyRoutineDb | null } = { db: null };

function Probe() {
  const db = useContext(DatabaseContext);
  useEffect(() => {
    captured.db = db;
  }, [db]);
  return (
    <>
      <p>db:{db?.name ?? 'none'}</p>
      {db && <UserMenu />}
    </>
  );
}

function session(handler?: Parameters<typeof fakeApi>[0]) {
  const fake = fakeApi(handler);
  const online = { value: false };
  const queryClient = new QueryClient();
  const tree = (auth: AuthApi, api: ApiClient = fake.api) => (
    <MemoryRouter>
      <AuthContext value={auth}>
        <ApiClientContext value={api}>
          <QueryClientProvider client={queryClient}>
            <AccountDataProvider
              syncOptions={{ locks: null, eventTarget: null, isOnline: () => online.value }}
            >
              <Probe />
            </AccountDataProvider>
          </QueryClientProvider>
        </ApiClientContext>
      </AuthContext>
    </MemoryRouter>
  );
  return { ...fake, online, tree };
}

const signedIn = (accountId: string) => fakeAuth({ accountId });

async function logOutFromMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));
}

describe('AccountDataProvider (review #2)', () => {
  it('opens no database while signed out', () => {
    const { tree } = session();
    render(tree(fakeAuth({ isAuthenticated: false })));
    expect(screen.getByText('db:none')).toBeTruthy();
  });

  it('gives each account its own database and clears per-account storage on a switch', async () => {
    const { tree } = session();
    const view = render(tree(signedIn(ANA)));
    expect(screen.getByText(`db:${accountDatabaseName(ANA)}`)).toBeTruthy();
    const anaDb = captured.db!;
    await createEvent(anaDb, { babyId: BABY_ID, typeId: TYPE_ID });
    writeSelectedBabyId(BABY_ID);

    view.rerender(tree(signedIn(BIA)));

    expect(screen.getByText(`db:${accountDatabaseName(BIA)}`)).toBeTruthy();
    const biaDb = captured.db!;
    expect(biaDb).not.toBe(anaDb);
    expect(await biaDb.events.count()).toBe(0);
    expect(await biaDb.outbox.count()).toBe(0);
    expect(readSelectedBabyId()).toBeNull();

    view.rerender(tree(signedIn(ANA)));
    expect(await captured.db!.events.count()).toBe(1);
  });

  it('deletes the legacy shared database', async () => {
    const legacy = new Dexie(LEGACY_DATABASE_NAME);
    legacy.version(1).stores({ events: 'id' });
    await legacy.open();
    legacy.close();
    const { tree } = session();

    render(tree(signedIn(ANA)));

    await waitFor(async () => expect(await Dexie.exists(LEGACY_DATABASE_NAME)).toBe(false));
  });
});

describe('log out (review #2)', () => {
  it('deletes the account database and its storage, keeps device preferences', async () => {
    const auth = signedIn(ANA);
    const { tree } = session();
    render(tree(auth));
    await captured.db!.open();
    writeSelectedBabyId(BABY_ID);
    writeCachedPredictions(BABY_ID, {
      data: { babyId: BABY_ID, generatedAt: 'x', predictions: [], insufficientData: [] },
      fetchedAt: 1,
    });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    await logOutFromMenu();

    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    expect(await Dexie.exists(accountDatabaseName(ANA))).toBe(false);
    expect(readSelectedBabyId()).toBeNull();
    expect(readCachedPredictions(BABY_ID)).toBeUndefined();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('warns about unsynced changes; Cancel keeps everything, Logout anyway discards', async () => {
    const auth = signedIn(ANA);
    const { tree } = session();
    render(tree(auth));
    await createEvent(captured.db!, { babyId: BABY_ID, typeId: TYPE_ID });

    await logOutFromMenu();
    expect(await screen.findByText('You have 1 unsynced change that will be lost.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(auth.logout).not.toHaveBeenCalled();
    expect(await captured.db!.outbox.count()).toBe(1);

    await logOutFromMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Logout anyway' }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    expect(await Dexie.exists(accountDatabaseName(ANA))).toBe(false);
  });

  it('counts dead-lettered changes as unsynced too', async () => {
    const { tree } = session();
    render(tree(signedIn(ANA)));
    await createEvent(captured.db!, { babyId: BABY_ID, typeId: TYPE_ID });
    await createEvent(captured.db!, { babyId: BABY_ID, typeId: TYPE_ID });
    await captured.db!.outbox.limit(1).modify({ status: 'dead' });

    await logOutFromMenu();

    expect(await screen.findByText('You have 2 unsynced changes that will be lost.')).toBeTruthy();
  });

  it('Push now uploads the queue first and then signs out', async () => {
    const auth = signedIn(ANA);
    const { tree, online, writes } = session();
    render(tree(auth));
    await createEvent(captured.db!, { babyId: BABY_ID, typeId: TYPE_ID });

    await logOutFromMenu();
    online.value = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Push now' }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    expect(writes().map((c) => c.method)).toEqual(['PUT']);
    expect(await Dexie.exists(accountDatabaseName(ANA))).toBe(false);
  });

  it('Push now that cannot upload keeps the dialog and the data', async () => {
    const auth = signedIn(ANA);
    const { tree, online } = session((call) => {
      if (call.method === 'PUT') throw networkError();
    });
    render(tree(auth));
    await createEvent(captured.db!, { babyId: BABY_ID, typeId: TYPE_ID });

    await logOutFromMenu();
    online.value = true;
    const push = await screen.findByRole('button', { name: 'Push now' });
    await act(async () => {
      fireEvent.click(push);
    });

    expect(await screen.findByText(/1 unsynced change could not be uploaded/)).toBeTruthy();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(await captured.db!.outbox.count()).toBe(1);
  });
});
