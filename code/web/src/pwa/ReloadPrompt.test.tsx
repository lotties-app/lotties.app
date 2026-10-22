import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { ReloadPrompt } from './ReloadPrompt';

const state = vi.hoisted(() => ({
  needRefresh: false,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(),
  registered: 0,
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => {
    state.registered += 1;
    return {
      needRefresh: [state.needRefresh, state.setNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: state.updateServiceWorker,
    };
  },
}));

let undoNative: (() => void) | undefined;

beforeEach(() => {
  state.needRefresh = false;
  state.registered = 0;
  state.setNeedRefresh.mockReset();
  state.updateServiceWorker.mockReset();
});

afterEach(() => {
  undoNative?.();
  undoNative = undefined;
});

describe('ReloadPrompt in the native app', () => {
  it('registers no service worker and shows nothing', () => {
    undoNative = pretendNativeApp();
    state.needRefresh = true;
    render(<ReloadPrompt />);
    expect(state.registered).toBe(0);
    expect(screen.queryByText('New version available')).toBeNull();
  });
});

describe('ReloadPrompt', () => {
  it('renders nothing visible while no update is waiting', () => {
    render(<ReloadPrompt />);
    expect(state.registered).toBeGreaterThan(0);
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
