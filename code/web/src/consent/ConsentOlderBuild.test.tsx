import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { loadSeenConsentVersion } from './consentStorage';
import { CONSENTS_PATH, acceptedView, consentsView, grantedCore } from './consentTestData';
import { GatedApp } from './consentTestKit';
import { PolicyUpdatedNotice } from './PolicyUpdatedNotice';
import { reloadPage } from './reloadPage';

/*
 * A build a few minor entries behind the server (docs/design/38-consent-and-terms.md section 11), over a list of its own: this
 * build carries V1 (material) and V2 (minor); the server is at V3, a minor entry this build does not know, and its minimum
 * version is V1. Accept posts V2, the server records V2, the app opens, and nothing loops.
 */
vi.mock('./reloadPage', () => ({ reloadPage: vi.fn() }));
vi.mock('../legal/consentVersions.json', () => ({
  default: {
    versions: [
      {
        version: '2026-01-01.1',
        terms: '1',
        privacyPolicy: '1',
        material: true,
        date: '2026-01-01',
        textDigest: 'x',
      },
      {
        version: '2026-02-01.1',
        terms: '1',
        privacyPolicy: '2',
        material: false,
        date: '2026-02-01',
        textDigest: 'x',
      },
    ],
  },
}));

const V1 = '2026-01-01.1';
const V2 = '2026-02-01.1';
const V3 = '2026-03-01.1';

let db: BabyRoutineDb;
let undoNative: (() => void) | undefined;

beforeEach(() => {
  db = testDatabase();
  window.sessionStorage.clear();
  vi.mocked(reloadPage).mockClear();
});

afterEach(async () => {
  undoNative?.();
  undoNative = undefined;
  await settleSync();
  await db.delete().catch(() => undefined);
});

function renderApp(handler: (call: ApiCall) => unknown) {
  const fake = fakeApi(handler);
  renderWithDb(
    db,
    <GatedApp>
      <PolicyUpdatedNotice />
      <p>the app</p>
    </GatedApp>,
    { api: fake.api },
  );
  return fake;
}

async function fillAndAccept() {
  fireEvent.click(await screen.findByRole('radio', { name: /parent or legal guardian/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I declare that I am/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
}

describe('a build only minor entries behind the server', () => {
  it('offers Accept, posts its own version, opens the app with no notice, no update panel and no reload', async () => {
    undoNative = pretendNativeApp('android');
    let accepted = false;
    const { calls } = renderApp((call) => {
      if (call.path === CONSENTS_PATH && call.method === 'GET') {
        return accepted
          ? acceptedView({
              currentVersion: V3,
              minimumVersion: V1,
              core: grantedCore({ version: V2 }),
              minorChangeSince: V3,
            })
          : consentsView({ currentVersion: V3, minimumVersion: V1 });
      }
      if (call.method === 'PUT') {
        accepted = true;
        return acceptedView({
          currentVersion: V3,
          minimumVersion: V1,
          core: grantedCore({ version: V2 }),
          minorChangeSince: V3,
        });
      }
      return undefined;
    });

    expect(screen.queryByRole('heading', { name: 'Update Lotties to continue' })).toBeNull();
    await fillAndAccept();

    expect(await screen.findByText('the app')).toBeTruthy();
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ version: V2 });
    // She saw V2: a later build that carries V3 still shows her the notice for it.
    expect(loadSeenConsentVersion()).toBe(V2);
    await settleSync();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Update Lotties to continue' })).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(
      calls.filter((call) => call.path === CONSENTS_PATH && call.method === 'GET').length,
    ).toBeLessThanOrEqual(2);
  });

  it('opens the app for a person who accepted the newer version elsewhere, with no notice', async () => {
    renderApp((call) =>
      call.path === CONSENTS_PATH && call.method === 'GET'
        ? acceptedView({
            currentVersion: V3,
            minimumVersion: V1,
            core: grantedCore({ version: V3 }),
          })
        : undefined,
    );

    expect(await screen.findByText('the app')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Update Lotties to continue' })).toBeNull();
  });
});

describe('a build below the server minimum', () => {
  it('shows the update panel instead of Accept', async () => {
    undoNative = pretendNativeApp('android');
    renderApp((call) =>
      call.path === CONSENTS_PATH && call.method === 'GET'
        ? consentsView({ currentVersion: V3, minimumVersion: V3 })
        : undefined,
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Update Lotties to continue' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull();
  });
});
