import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeletionPreview } from '../account/accountApi';
import type { BabyRoutineDb } from '../db/database';
import { fakeApi, httpError, testDatabase } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { renderWithDb, settleSync } from '../test/renderApp';
import { DeleteAccountSection } from './DeleteAccountSection';

/* Settings > Account and data: preview of what is deleted, the confirmation and the finish step. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const preview = (overrides: Partial<AccountDeletionPreview> = {}): AccountDeletionPreview => ({
  deletedBabies: [{ id: 'b1', name: 'Lia' }],
  sharedBabies: [{ id: 'b2', name: 'Noah' }],
  blockedBabies: [],
  canDelete: true,
  ...overrides,
});

function renderSection(handler: (path: string, method: string) => unknown, auth = fakeAuth()) {
  const { api, calls } = fakeApi((call) => handler(call.path, call.method));
  renderWithDb(db, <DeleteAccountSection />, { api, auth });
  return { calls, auth };
}

describe('delete account in settings', () => {
  it('lists what is deleted and what stays, and asks for an acknowledgement', async () => {
    const { calls } = renderSection((path) =>
      path === '/api/v1/me/deletion-preview' ? preview() : undefined,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));

    expect(await screen.findByText('Lia')).toBeTruthy();
    expect(screen.getByText('Noah')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Delete everything' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand that this is permanent.' }));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('cannot delete while the user is the only owner of a shared baby', async () => {
    renderSection(() => preview({ blockedBabies: [{ id: 'b3', name: 'Zoe' }], canDelete: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));

    expect(await screen.findByText('Zoe')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand that this is permanent.' }));
    expect(
      (screen.getByRole('button', { name: 'Delete everything' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('deletes the account, then signs out on Finish and warns when the sign-in account stays', async () => {
    const auth = fakeAuth();
    const { calls } = renderSection(
      (path, method) =>
        method === 'DELETE' && path === '/api/v1/me'
          ? { identityRemoved: false }
          : path === '/api/v1/me/deletion-preview'
            ? preview()
            : undefined,
      auth,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'I understand that this is permanent.' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    expect(await screen.findByText('Account deleted')).toBeTruthy();
    expect(screen.getByText(/sign-in account still exists/)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(auth.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
  });

  it('keeps the dialog open with the error when the server refuses', async () => {
    renderSection((path, method) => {
      if (method === 'DELETE') throw httpError(409, 'account_deletion_blocked');
      return path === '/api/v1/me/deletion-preview' ? preview() : undefined;
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'I understand that this is permanent.' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    expect(await screen.findByText(/only owner of a baby that other people use/)).toBeTruthy();
    expect(screen.queryByText('Account deleted')).toBeNull();
  });
});
