import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import { clearBabyDeviceState } from '../db/purge';
import { TimeBottlesSync } from '../presets/FeedingSettingsSync';
import {
  clearTimeBottles,
  isTimeBottlesPending,
  loadTimeBottles,
  storeTimeBottles,
} from '../presets/timeBottlesStorage';
import { claimDeviceState, clearAccountDeviceState } from '../session/deviceState';
import { fakeApi, networkError, type ApiCall } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
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

  it('forgets an unconfirmed change with the rest', () => {
    storeTimeBottles(true);
    window.localStorage.setItem('baby-routine.time-bottles-pending', 'yes');
    expect(isTimeBottlesPending()).toBe(true);
    clearAccountDeviceState();
    expect(isTimeBottlesPending()).toBe(false);
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

const PATH = '/api/v1/me/feeding-settings';
const feedingCalls = (calls: ApiCall[]) => calls.filter((c) => c.path === PATH);

function renderSection(handler: (call: ApiCall) => unknown = () => undefined) {
  const fake = fakeApi(handler);
  const view = render(
    <AuthContext value={fakeAuth()}>
      <ApiClientContext value={fake.api}>
        <TimeBottlesSync />
        <FeedingSection />
      </ApiClientContext>
    </AuthContext>,
  );
  return { ...fake, ...view };
}

const toggle = () => screen.getByRole('switch', { name: 'Time bottle feedings' }) as HTMLInputElement;

describe('FeedingSection', () => {
  it('shows the switch off and saves a change on the server', async () => {
    const { calls } = renderSection();
    await waitFor(() => expect(feedingCalls(calls)).toHaveLength(1)); // the load-time read
    expect(toggle().checked).toBe(false);
    expect(screen.getByText(/Applies to your account on all babies/)).toBeTruthy();

    fireEvent.click(toggle());

    expect(toggle().checked).toBe(true);
    expect(loadTimeBottles()).toBe(true);
    await waitFor(() => expect(isTimeBottlesPending()).toBe(false));
    expect(feedingCalls(calls).at(-1)).toMatchObject({
      method: 'PUT',
      body: { timeBottleFeedings: true },
    });
  });

  it('reads the stored choice and uploads it once when the server never had one', async () => {
    storeTimeBottles(true);
    const { calls } = renderSection((call) =>
      call.method === 'GET'
        ? { timeBottleFeedings: null, updatedAt: null }
        : { timeBottleFeedings: true },
    );
    expect(toggle().checked).toBe(true);
    await waitFor(() => expect(feedingCalls(calls).map((c) => c.method)).toEqual(['GET', 'PUT']));
    expect(feedingCalls(calls)[1].body).toEqual({ timeBottleFeedings: true });
  });

  it('does not create a server row for a local "off" the server never had', async () => {
    const { calls } = renderSection(() => ({ timeBottleFeedings: null, updatedAt: null }));
    await waitFor(() => expect(feedingCalls(calls)).toHaveLength(1));
    expect(feedingCalls(calls).map((c) => c.method)).toEqual(['GET']);
  });

  it("adopts the server's value over the cached one", async () => {
    storeTimeBottles(false);
    renderSection(() => ({ timeBottleFeedings: true, updatedAt: '2026-11-01T10:00:00Z' }));
    await waitFor(() => expect(toggle().checked).toBe(true));
    expect(loadTimeBottles()).toBe(true);
  });

  it('keeps a failed change locally and retries it on the next load', async () => {
    let offline = true;
    const handler = (call: ApiCall) => {
      if (offline) throw networkError();
      return call.method === 'GET' ? { timeBottleFeedings: false, updatedAt: null } : undefined;
    };
    const first = renderSection(handler);
    await waitFor(() => expect(feedingCalls(first.calls)).toHaveLength(1));
    fireEvent.click(toggle());
    await waitFor(() => expect(feedingCalls(first.calls).some((c) => c.method === 'PUT')).toBe(true));
    expect(loadTimeBottles()).toBe(true);
    expect(isTimeBottlesPending()).toBe(true);
    first.unmount();

    offline = false;
    const second = renderSection(handler);
    await waitFor(() => expect(isTimeBottlesPending()).toBe(false));
    // The pending local value was sent, not overwritten by the server's older "false".
    expect(feedingCalls(second.calls)[0]).toMatchObject({
      method: 'PUT',
      body: { timeBottleFeedings: true },
    });
    expect(loadTimeBottles()).toBe(true);
  });

  it('keeps the local value when the server is unreachable on load', async () => {
    storeTimeBottles(true);
    const { calls } = renderSection(() => {
      throw networkError();
    });
    await waitFor(() => expect(feedingCalls(calls)).toHaveLength(1));
    expect(loadTimeBottles()).toBe(true);
    expect(toggle().checked).toBe(true);
  });
});
