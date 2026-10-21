import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReloadPrompt } from './ReloadPrompt';

const state = vi.hoisted(() => ({
  needRefresh: false,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [state.needRefresh, state.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: state.updateServiceWorker,
  }),
}));

beforeEach(() => {
  state.needRefresh = false;
  state.setNeedRefresh.mockReset();
  state.updateServiceWorker.mockReset();
});

describe('ReloadPrompt', () => {
  it('renders nothing visible while no update is waiting', () => {
    render(<ReloadPrompt />);
    expect(screen.queryByText('New version available')).toBeNull();
  });

  it('shows the update snackbar when a new version is waiting', () => {
    state.needRefresh = true;
    render(<ReloadPrompt />);
    expect(screen.getByText('New version available')).toBeTruthy();
  });

  it('reloads through the service worker when Reload is pressed', () => {
    state.needRefresh = true;
    render(<ReloadPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });
});
