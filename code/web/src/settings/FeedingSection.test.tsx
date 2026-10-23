import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearBabyDeviceState } from '../db/purge';
import {
  clearAllTimeBottles,
  loadTimeBottles,
  storeTimeBottles,
} from '../presets/timeBottlesStorage';
import { clearAccountDeviceState } from '../session/deviceState';
import { FeedingSection } from './FeedingSection';

beforeEach(() => {
  window.localStorage.clear();
});

describe('"Time bottle feedings" storage (per baby, on this device)', () => {
  it('is off by default and per baby', () => {
    expect(loadTimeBottles('b1')).toBe(false);
    storeTimeBottles('b1', true);
    expect(loadTimeBottles('b1')).toBe(true);
    expect(loadTimeBottles('b2')).toBe(false);
    storeTimeBottles('b1', false);
    expect(loadTimeBottles('b1')).toBe(false);
  });

  it('is forgotten when the baby leaves the device and on sign-out', () => {
    storeTimeBottles('b1', true);
    storeTimeBottles('b2', true);
    clearBabyDeviceState(['b1']);
    expect([loadTimeBottles('b1'), loadTimeBottles('b2')]).toEqual([false, true]);
    clearAccountDeviceState();
    expect(loadTimeBottles('b2')).toBe(false);
    storeTimeBottles('b3', true);
    clearAllTimeBottles();
    expect(loadTimeBottles('b3')).toBe(false);
  });
});

describe('FeedingSection', () => {
  it('shows the switch off and remembers a change', () => {
    render(<FeedingSection babyId="b1" />);
    const toggle = screen.getByRole('switch', { name: 'Time bottle feedings' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/the bottle button logs the feeding right away/)).toBeTruthy();

    fireEvent.click(toggle);

    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(loadTimeBottles('b1')).toBe(true);
  });

  it('reads the stored choice', () => {
    storeTimeBottles('b1', true);
    render(<FeedingSection babyId="b1" />);
    expect(
      (screen.getByRole('switch', { name: 'Time bottle feedings' }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
