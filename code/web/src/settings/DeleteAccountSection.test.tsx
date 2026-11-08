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
    expect(
      screen.getByText(/sign-in server still exists, because this server cannot delete it/),
    ).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(auth.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
  });

  it.each([
    [true, /sign-in account at our sign-in server \(name, email and password\) is deleted too/],
    [false, /This server does not delete your sign-in account/],
    [undefined, /This server does not delete your sign-in account/],
  ])(
    'says before the deletion whether the sign-in account goes too (removable: %s)',
    async (identityRemovable, text) => {
      renderSection((path) =>
        path === '/api/v1/me/deletion-preview' ? preview({ identityRemovable }) : undefined,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));

      expect(await screen.findByText(text)).toBeTruthy();
    },
  );

  it.each([
    ['removed', null],
    ['not_configured', /still exists, because this server cannot delete it by itself/],
    ['failed', /deleting your sign-in account at our sign-in server failed/],
  ])(
    'after the deletion, says what happened to the sign-in account (%s)',
    async (identity, text) => {
      renderSection((path, method) =>
        method === 'DELETE' && path === '/api/v1/me'
          ? { identityRemoved: identity === 'removed', identity }
          : path === '/api/v1/me/deletion-preview'
            ? preview()
            : undefined,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
      fireEvent.click(
        await screen.findByRole('checkbox', { name: 'I understand that this is permanent.' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

      expect(await screen.findByText('Account deleted')).toBeTruthy();
      if (text) expect(screen.getByText(text)).toBeTruthy();
      else expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('offers to delete the records in her own database only when a baby is there', async () => {
    renderSection((path) => (path === '/api/v1/me/deletion-preview' ? preview() : undefined));

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));

    expect(await screen.findByText('Lia')).toBeTruthy();
    expect(screen.queryByText(/in your own database/)).toBeNull();
    expect(
      screen.queryByRole('checkbox', {
        name: "Also delete these babies' records in my own database",
      }),
    ).toBeNull();
  });

  it.each([
    [false, '/api/v1/me'],
    [true, '/api/v1/me?wipeOwnDatabase=true'],
  ])(
    'deletes the records in her own database only when she ticks the box (%s)',
    async (tick, deletePath) => {
      const { calls } = renderSection((path, method) =>
        method === 'DELETE'
          ? { identityRemoved: true, identity: 'removed' }
          : path === '/api/v1/me/deletion-preview'
            ? preview({ ownDatabaseBabies: [{ id: 'b1', name: 'Lia' }] })
            : undefined,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
      const wipe = await screen.findByRole('checkbox', {
        name: "Also delete these babies' records in my own database",
      });
      expect((wipe as HTMLInputElement).checked).toBe(false);
      expect(
        screen.getByText(/The records of these babies are in your own database/),
      ).toBeTruthy();
      if (tick) fireEvent.click(wipe);
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'I understand that this is permanent.' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

      expect(await screen.findByText('Account deleted')).toBeTruthy();
      expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
        deletePath,
      ]);
      expect(screen.queryByText(/could not reach your own database/)).toBeNull();
    },
  );

  it('lists the babies whose records in her own database could not be deleted', async () => {
    renderSection((path, method) =>
      method === 'DELETE'
        ? {
            identityRemoved: true,
            identity: 'removed',
            ownDatabaseWiped: [],
            ownDatabaseNotWiped: ['b1'],
          }
        : path === '/api/v1/me/deletion-preview'
          ? preview({ ownDatabaseBabies: [{ id: 'b1', name: 'Lia' }] })
          : undefined,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: "Also delete these babies' records in my own database",
      }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I understand that this is permanent.' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    expect(await screen.findByText('Account deleted')).toBeTruthy();
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toMatch(/could not reach your own database/);
    expect(notice.textContent).toMatch(/Lia/);
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
