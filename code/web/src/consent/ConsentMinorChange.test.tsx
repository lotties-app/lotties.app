import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, networkError, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { loadSeenConsentVersion } from './consentStorage';
import { CONSENTS_PATH, acceptedView, rememberConsent } from './consentTestData';
import { GatedApp } from './consentTestKit';
import { PolicyUpdatedNotice } from './PolicyUpdatedNotice';

/*
 * A minor change (docs/design/38-consent-and-terms.md section 3, closes gap G6), over a list of its own: 1 material (the first),
 * then 2 and 3 minor. The real list has one entry, so the rules need a list to run on.
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
        privacyPolicy: '2',
        material: false,
        date: '2026-03-15',
        textDigest: 'x',
      },
    ],
  },
}));

const V1 = '2026-01-01.1';
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

/** The server: accepted at V1, the newest version V3 is only a minor change away. */
const acceptedAtV1 = (call: ApiCall) =>
  call.path === CONSENTS_PATH
    ? acceptedView({
        currentVersion: V3,
        core: { ...acceptedView().core!, version: V1 },
        minorChangeSince: V3,
      })
    : undefined;

describe('a minor change', () => {
  it('keeps the app open and shows a dismissible notice with the date and a link to the policy', async () => {
    rememberConsent(V1);
    renderApp(acceptedAtV1);

    expect(await screen.findByText('the app')).toBeTruthy();
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain(
      'We updated the Privacy Policy and the Terms of Use on Mar 15, 2026.',
    );
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See what changed' }).getAttribute('href')).toBe(
      '/privacy',
    );
  });

  it('dismissing stores the version seen on this device, and the notice does not come back', async () => {
    rememberConsent(V1);
    const first = renderApp(acceptedAtV1);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(loadSeenConsentVersion()).toBe(V3);
    expect(first.calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('is not shown again after a reload once it was dismissed', async () => {
    rememberConsent(V1);
    window.localStorage.setItem('baby-routine.consent-seen', V3);
    renderApp(acceptedAtV1);

    await screen.findByText('the app');
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows in Brazilian Portuguese', async () => {
    await useTestLocale('pt-BR');
    rememberConsent(V1);
    renderApp(acceptedAtV1);

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain(
      'Atualizamos a Política de Privacidade e os Termos de Uso em 15 de mar. de 2026.',
    );
    expect(screen.getByRole('link', { name: 'Ver o que mudou' })).toBeTruthy();
  });

  it('shows from the remembered version alone while offline', async () => {
    rememberConsent(V1);
    renderApp(() => {
      throw networkError();
    });

    expect(await screen.findByText('the app')).toBeTruthy();
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
