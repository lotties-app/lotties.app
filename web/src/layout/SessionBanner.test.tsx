import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthApi } from '../auth/AuthContext';
import { ConfirmDeleteDialog } from '../events/ConfirmDeleteDialog';
import { UnsyncedChangesDialog } from '../session/UnsyncedChangesDialog';
import { SyncEngine } from '../sync/SyncEngine';
import { fakeAuth } from '../test/fakeAuth';
import { fakeApi, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import type { BabyRoutineDb } from '../db/database';
import { RENEWING_NOTICE_DELAY_MS, SessionBanner } from './SessionBanner';
import { SyncIconButton } from './SyncIconButton';
import { syncLabel } from './syncPresentation';
import { INITIAL_SYNC_STATUS } from '../sync/syncStatus';

let db: BabyRoutineDb;
let engine: SyncEngine;

beforeEach(() => {
  db = testDatabase();
  engine = new SyncEngine({ db, api: fakeApi().api, locks: null, eventTarget: null });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

const renderBanner = (auth: AuthApi) =>
  renderWithDb(db, <SessionBanner />, { auth, engine, route: '/timeline?day=2' });

describe('SessionBanner', () => {
  it('announces a background renewal that takes a moment, calmly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderBanner(fakeAuth({ session: 'renewing' }));
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(RENEWING_NOTICE_DELAY_MS);
    });

    expect(screen.getByRole('status').textContent).toMatch(/^Reconnecting your account/);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('stays quiet while offline (the offline state is shown elsewhere) and when active', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBanner(fakeAuth({ session: 'waiting' }));
    act(() => {
      vi.advanceTimersByTime(RENEWING_NOTICE_DELAY_MS * 2);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks to sign in again when the server refuses the session, keeping the page', () => {
    const auth = fakeAuth();
    renderBanner(auth);
    act(() => engine.status.update({ authRequired: true }));

    expect(screen.getByText('Sign in again to sync your changes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.login).toHaveBeenCalledWith('/timeline?day=2');
  });
});

describe('sync indicator', () => {
  it('badges changes that need attention and names them', () => {
    renderWithDb(db, <SyncIconButton />, { engine });
    act(() => engine.status.update({ deadLetterCount: 1, attentionCount: 1 }));

    const link = screen.getByRole('link', { name: /needs your attention/ });
    expect(link.getAttribute('aria-label')).toBe(
      'Sync: Synced · 1 needs your attention. Open sync settings',
    );
    expect(screen.getByTestId('sync-attention-badge').textContent).toContain('1');
  });

  it('labels a token renewal as reconnecting, not as an error', () => {
    expect(syncLabel({ ...INITIAL_SYNC_STATUS, waitingForToken: true })).toBe('Reconnecting');
    expect(syncLabel({ ...INITIAL_SYNC_STATUS, state: 'offline', deadLetterCount: 2 })).toBe(
      'Offline · 2 failed',
    );
  });
});

describe('dialogs are named by their title', () => {
  it('names the confirmation dialogs', () => {
    render(<ConfirmDeleteDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Delete this event?' })).toBeTruthy();
  });

  it('names the unsynced changes warning', () => {
    render(
      <UnsyncedChangesDialog
        title="Log out?"
        message="m"
        pushLabel="Push"
        proceedLabel="Go"
        onPush={vi.fn()}
        onProceed={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Log out?' })).toBeTruthy();
  });
});
