import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, networkError, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { ConsentSection } from './ConsentSection';
import { CONSENTS_PATH, acceptedView, grantedCore } from './consentTestData';

const downloadAccountData = vi.fn(async () => true);
const downloadProfessionalData = vi.fn(async () => true);
vi.mock('../account/exportAccountData', () => ({
  downloadAccountData: (...args: unknown[]) => downloadAccountData(...(args as [])),
}));
vi.mock('../account/exportProfessionalData', () => ({
  downloadProfessionalData: (...args: unknown[]) => downloadProfessionalData(...(args as [])),
}));

/* Settings > Privacy and data: what was accepted, the optional consents, and how to withdraw. */

/** The current path and hash (the shared LocationProbe leaves the hash out). */
function PlaceProbe() {
  const { pathname, hash } = useLocation();
  return (
    <span hidden data-testid="place">
      {pathname + hash}
    </span>
  );
}

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
  downloadAccountData.mockClear();
  downloadProfessionalData.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

function renderSection(view = acceptedView(), variant: 'family' | 'professional' = 'family') {
  const { api, calls } = fakeApi((call) => (call.path === CONSENTS_PATH ? view : undefined));
  renderWithDb(
    db,
    <>
      <ConsentSection variant={variant} />
      <PlaceProbe />
    </>,
    { api },
  );
  return calls;
}

describe('Privacy and data', () => {
  it('shows what she accepted, when, and as whom, with links to the terms and the policy', async () => {
    renderSection(
      acceptedView({
        core: grantedCore({ acceptedAt: '2026-10-27T12:00:00.000Z', capacity: 'authorised' }),
      }),
    );

    expect(
      await screen.findByText(/You accepted version .* on Oct 27, 2026, as an authorised adult\./),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read the Terms of use' }).getAttribute('href')).toBe(
      '/terms',
    );
    expect(screen.getByRole('link', { name: 'Read the Privacy policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
  });

  it('lists the optional consents with their state: on, off or never turned on', async () => {
    renderSection(
      acceptedView({
        optional: {
          push: grantedCore({ acceptedAt: '2026-10-20T12:00:00.000Z', capacity: null }),
          alexa: grantedCore({
            accepted: false,
            capacity: null,
            withdrawnAt: '2026-10-25T12:00:00.000Z',
          }),
          mcp: null,
        },
      }),
    );

    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]).getByText('Reminders (push notifications)')).toBeTruthy();
    expect(within(items[0]).getByText('On since Oct 20, 2026')).toBeTruthy();
    expect(within(items[1]).getByText('Alexa')).toBeTruthy();
    expect(within(items[1]).getByText('Off since Oct 25, 2026')).toBeTruthy();
    expect(within(items[2]).getByText('AI assistants')).toBeTruthy();
    expect(within(items[2]).getByText('Never turned on')).toBeTruthy();
  });

  it('says she has not accepted when nothing is recorded', async () => {
    renderSection({ ...acceptedView(), core: null, requiresAcceptance: true });

    expect(await screen.findByText('You have not accepted the current version yet.')).toBeTruthy();
  });

  it('withdrawing explains it and leads to the export and the account deletion', async () => {
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw my consent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw your consent' });
    expect(within(dialog).getByText(/cannot work without it/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(downloadAccountData).toHaveBeenCalledTimes(1));
    expect(downloadProfessionalData).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Go to delete my account' }));
    await waitFor(() => expect(screen.getByTestId('place').textContent).toBe('/settings#account'));
  });

  it('a doctor exports only what she produced and lands on her own settings', async () => {
    renderSection(acceptedView(), 'professional');

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw my consent' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(downloadProfessionalData).toHaveBeenCalledTimes(1));
    expect(downloadAccountData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Go to delete my account' }));
    await waitFor(() =>
      expect(screen.getByTestId('place').textContent).toBe('/doctor/settings#account'),
    );
  });

  it('shows in Brazilian Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderSection();

    expect(
      await screen.findByText(
        /Você aceitou a versão .* em 27 de out\. de 2026, como pai, mãe ou responsável legal da criança\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirar meu consentimento' })).toBeTruthy();
    expect(screen.getByText('Lembretes (notificações push)')).toBeTruthy();
    expect(screen.getAllByText('Nunca foi ligado')).toHaveLength(3);
  });

  it('tells a failed load', async () => {
    const { api } = fakeApi(() => {
      throw networkError();
    });
    renderWithDb(db, <ConsentSection />, { api });

    expect(await screen.findByText('We could not load your consent records.')).toBeTruthy();
  });
});
