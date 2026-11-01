import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearBabyDeviceState } from '../db/purge';
import { clearTimeBottles, loadTimeBottles, storeTimeBottles } from '../presets/timeBottlesStorage';
import { claimDeviceState, clearAccountDeviceState } from '../session/deviceState';
import { FeedingSection } from './FeedingSection';

beforeEach(() => {
  window.localStorage.clear();
});

describe('"Time bottle feedings" storage (per account)', () => {
  it('is off by default and one value for all babies', () => {
    expect(loadTimeBottles()).toBe(false);
    storeTimeBottles(true);
    expect(loadTimeBottles()).toBe(true);
    storeTimeBottles(false);
    expect(loadTimeBottles()).toBe(false);
  });

  it('survives a baby leaving the device and is forgotten on sign-out', () => {
    storeTimeBottles(true);
    clearBabyDeviceState(['b1']);
    expect(loadTimeBottles()).toBe(true);
    clearAccountDeviceState();
    expect(loadTimeBottles()).toBe(false);
    storeTimeBottles(true);
    clearTimeBottles();
    expect(loadTimeBottles()).toBe(false);
  });

  it('is cleared when another account claims the device', () => {
    claimDeviceState('account-a');
    storeTimeBottles(true);
    claimDeviceState('account-b');
    expect(loadTimeBottles()).toBe(false);
  });

  it('migrates the per-baby keys once: any baby on turns it on, old keys go', () => {
    window.localStorage.setItem('baby-routine.time-bottles.b1', 'on');
    window.localStorage.setItem('baby-routine.time-bottles.b2', 'on');
    expect(loadTimeBottles()).toBe(true);
    expect(window.localStorage.getItem('baby-routine.time-bottles.b1')).toBeNull();
    expect(window.localStorage.getItem('baby-routine.time-bottles.b2')).toBeNull();
    storeTimeBottles(false);
    expect(loadTimeBottles()).toBe(false);
  });

  it('migrates to off when no baby had it on', () => {
    window.localStorage.setItem('baby-routine.time-bottles.b1', 'off');
    expect(loadTimeBottles()).toBe(false);
    expect(window.localStorage.getItem('baby-routine.time-bottles.b1')).toBeNull();
  });
});

describe('FeedingSection', () => {
  it('shows the switch off and remembers a change', () => {
    render(<FeedingSection />);
    const toggle = screen.getByRole('switch', { name: 'Time bottle feedings' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Applies to your account on all babies/)).toBeTruthy();

    fireEvent.click(toggle);

    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(loadTimeBottles()).toBe(true);
  });

  it('reads the stored choice', () => {
    storeTimeBottles(true);
    render(<FeedingSection />);
    expect(
      (screen.getByRole('switch', { name: 'Time bottle feedings' }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
