import { describe, expect, it, vi } from 'vitest';
import { followBackButton } from './backButton';
import { fakeNativeShell } from './nativeTestKit';
import { startNativeShell } from './startNativeShell';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Android's back button in the store app", () => {
  it('goes back in the app history while there is one', async () => {
    const shell = fakeNativeShell();
    const history = { back: vi.fn() };
    followBackButton(shell, history);
    await settle();
    shell.pressBack(true);
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(shell.exitApp).not.toHaveBeenCalled();
  });

  it('closes the app only on the first page', async () => {
    const shell = fakeNativeShell();
    const history = { back: vi.fn() };
    followBackButton(shell, history);
    await settle();
    shell.pressBack(false);
    expect(history.back).not.toHaveBeenCalled();
    expect(shell.exits).toBe(1);
  });

  it('stops listening when stopped, also before the listener was registered', async () => {
    const shell = fakeNativeShell();
    const stop = followBackButton(shell, { back: vi.fn() });
    stop();
    await settle();
    expect(shell.listenerCount()).toBe(0);
  });

  it('is part of the native start-up', async () => {
    const shell = fakeNativeShell();
    const stop = startNativeShell(shell);
    await settle();
    expect(shell.listenerCount()).toBe(1);
    stop();
    expect(shell.listenerCount()).toBe(0);
  });
});
