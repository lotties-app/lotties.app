import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, networkError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { CONSENTS_PATH, acceptedView, consentsView, rememberConsent } from './consentTestData';
import { GatedApp } from './consentTestKit';
import { PolicyUpdatedNotice } from './PolicyUpdatedNotice';

/*
 * A material change (docs/design/38-consent-and-terms.md section 3), over a list of its own: 1 material (the first), 2 minor, 3
 * material. Whoever accepted before the last material entry sees the consent screen again; whoever accepted at or after it does not.
 */
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
      {
        version: '2026-03-01.1',
        terms: '2',
        privacyPolicy: '3',
        material: true,
        date: '2026-03-01',
        textDigest: 'x',
      },
    ],
  },
}));

const V1 = '2026-01-01.1';
const V2 = '2026-02-01.1';
const V3 = '2026-03-01.1';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
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

describe('a material change', () => {
  it.each([V1, V2])('asks again someone whose server record is at %s', async (accepted) => {
    rememberConsent(accepted);
    renderApp((call) =>
      call.path === CONSENTS_PATH
        ? consentsView({
            currentVersion: V3,
            core: { ...acceptedView().core!, version: accepted },
            requiresAcceptance: true,
          })
        : undefined,
    );

    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('knows from the remembered version alone, offline, that it is stale', async () => {
    rememberConsent(V2);
    renderApp(() => {
      throw networkError();
    });

    expect(await screen.findByRole('heading', { name: 'Before you start' })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('does not ask someone who accepted the newest version, and shows no notice', async () => {
    rememberConsent(V3);
    renderApp((call) =>
      call.path === CONSENTS_PATH
        ? acceptedView({ currentVersion: V3, core: { ...acceptedView().core!, version: V3 } })
        : undefined,
    );

    expect(await screen.findByText('the app')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
