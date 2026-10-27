import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { clearAccountDeviceState } from '../session/deviceState';
import { loadAcceptedConsent, storeAcceptedConsent } from './consentStorage';
import { ConsentContext, SIGNED_OUT_CONSENT, type ConsentStatus } from './ConsentContext';

/*
 * Where the gate sits in the route tree (docs/design/38-consent-and-terms.md section 5): between the auth guard and every baby
 * screen (the app, the invite page, the doctor's dashboard); the public pages are outside it.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  clearAccountDeviceState();
  await settleSync();
  await db.delete();
});

function renderAt(route: string, status: ConsentStatus) {
  renderWithDb(
    db,
    <ConsentContext value={{ ...SIGNED_OUT_CONSENT, status }}>
      <AppRoutes />
    </ConsentContext>,
    { route, api: fakeApi().api },
  );
}

describe('the consent gate in the routes', () => {
  it.each(['/settings', '/day', '/hub', '/doctor', '/invite'])(
    'shows the consent screen instead of %s while a consent is required',
    async (route) => {
      renderAt(route, 'required');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Before you start' }),
      ).toBeTruthy();
      expect(screen.queryByRole('navigation')).toBeNull();
    },
  );

  it('shows a spinner while the answer is not known yet', async () => {
    renderAt('/settings', 'checking');

    expect(await screen.findByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
  });

  it('opens the screens once the consent is accepted', async () => {
    renderAt('/settings', 'accepted');

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
  });

  it.each([
    ['/terms', 'Terms of use'],
    ['/privacy', 'Privacy policy'],
  ])('keeps the public page %s open without a consent', async (route, title) => {
    renderAt(route, 'required');

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
  });

  it('has Settings > Privacy and data in the settings of an accepted account', async () => {
    renderAt('/settings', 'accepted');

    expect(await screen.findByRole('button', { name: 'Privacy and data' })).toBeTruthy();
  });
});

describe('what the device remembers', () => {
  it('is removed with the rest of the account’s state on sign-out', () => {
    storeAcceptedConsent({ version: '2026-10-27.1', capacity: 'guardian' });
    window.localStorage.setItem('baby-routine.consent-seen', '2026-10-27.1');
    window.localStorage.setItem('baby-routine.consent-optional-pending', '{"push":true}');

    clearAccountDeviceState();

    expect(loadAcceptedConsent()).toBeNull();
    expect(window.localStorage.getItem('baby-routine.consent-seen')).toBeNull();
    expect(window.localStorage.getItem('baby-routine.consent-optional-pending')).toBeNull();
  });
});
