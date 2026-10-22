import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SelectedBabyContext } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import { deepLinkUrl, type NotificationLink } from '../pwa/sw/deepLink';
import { BABY_ID, DELIVERY_ID, RX_ID, TOKEN } from '../pwa/sw/pushTestKit';
import type { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import { useNotificationLink } from './notificationLinkContext';
import { NotificationLinkProvider } from './NotificationLinkProvider';
import { linkFromLocation, pullBriefly } from './notificationLinks';

const LIA: Baby = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const DOSE: NotificationLink = {
  kind: 'dose',
  babyId: BABY_ID,
  rxId: RX_ID,
  deliveryId: DELIVERY_ID,
  token: TOKEN,
};

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe() {
  const links = useNotificationLink();
  const location = useLocation();
  return (
    <>
      <output data-testid="link">{JSON.stringify(links?.link ?? null)}</output>
      <output data-testid="path">{location.pathname}</output>
      <button type="button" onClick={() => links?.consume()}>
        consume
      </button>
    </>
  );
}

function renderProvider(babies: Baby[] | undefined, route = '/') {
  const select = vi.fn();
  const syncNow = vi.fn(() => Promise.resolve());
  render(
    <SyncEngineContext value={{ syncNow } as unknown as SyncEngine}>
      <SelectedBabyContext value={{ babies, baby: babies?.[0], select }}>
        <MemoryRouter initialEntries={[route]}>
          <NotificationLinkProvider>
            <Probe />
          </NotificationLinkProvider>
        </MemoryRouter>
      </SelectedBabyContext>
    </SyncEngineContext>,
  );
  return { select, syncNow };
}

const shownLink = () => JSON.parse(screen.getByTestId('link').textContent ?? 'null') as unknown;

describe('linkFromLocation', () => {
  it('reads the link on the Now route only', () => {
    const url = new URL(deepLinkUrl(DOSE), 'https://app.example');
    expect(linkFromLocation(url)).toEqual(DOSE);
    expect(linkFromLocation({ pathname: '/settings', hash: url.hash })).toBeNull();
    expect(linkFromLocation({ pathname: '/', hash: '#notifications' })).toBeNull();
  });

  it('reads an appointment reminder link on the appointments route only', () => {
    const link = {
      kind: 'appt',
      babyId: DOSE.babyId,
      appointmentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      deliveryId: DOSE.deliveryId,
    } as const;
    const url = new URL(deepLinkUrl(link), 'https://app.example');
    expect(url.pathname).toBe('/appointments');
    expect(linkFromLocation(url)).toEqual(link);
    expect(linkFromLocation({ pathname: '/', hash: url.hash })).toBeNull();
  });
});

describe('pullBriefly', () => {
  it('waits for the pull, at most the given time, and never rejects', async () => {
    await expect(pullBriefly(null)).resolves.toBeUndefined();
    await expect(
      pullBriefly({ syncNow: () => Promise.reject(new Error('offline')) }),
    ).resolves.toBeUndefined();
    const hanging = { syncNow: () => new Promise<void>(() => undefined) };
    const started = Date.now();
    await pullBriefly(hanging, 20);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('NotificationLinkProvider', () => {
  it('takes the deep link of a new window, strips it, selects the baby and pulls first', async () => {
    window.history.replaceState(null, '', deepLinkUrl(DOSE));
    const { select, syncNow } = renderProvider([LIA]);
    await waitFor(() => expect(shownLink()).toEqual(DOSE));
    expect(select).toHaveBeenCalledWith(BABY_ID);
    expect(syncNow).toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    act(() => screen.getByRole('button', { name: 'consume' }).click());
    expect(shownLink()).toBeNull();
  });

  it('waits for the local babies before deciding', async () => {
    window.history.replaceState(null, '', deepLinkUrl(DOSE));
    const { select } = renderProvider(undefined);
    expect(select).not.toHaveBeenCalled();
    expect(shownLink()).toBeNull();
  });

  it('ignores a link for a baby the user does not belong to', async () => {
    window.history.replaceState(null, '', deepLinkUrl({ ...DOSE, babyId: RX_ID }));
    const { select, syncNow } = renderProvider([LIA]);
    await act(async () => {});
    expect(select).not.toHaveBeenCalled();
    expect(syncNow).not.toHaveBeenCalled();
    expect(shownLink()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('takes a validated message from the worker in an open window and goes to Now', async () => {
    const worker = new EventTarget();
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { serviceWorker: worker }));
    renderProvider([LIA], '/settings');
    act(() => {
      worker.dispatchEvent(new MessageEvent('message', { data: { type: 'other' } }));
    });
    expect(screen.getByTestId('path').textContent).toBe('/settings');
    act(() => {
      worker.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'notification-open',
            kind: 'nap_window',
            babyId: BABY_ID,
            deliveryId: DELIVERY_ID,
          },
        }),
      );
    });
    await waitFor(() =>
      expect(shownLink()).toEqual({ kind: 'nap', babyId: BABY_ID, deliveryId: DELIVERY_ID }),
    );
    expect(screen.getByTestId('path').textContent).toBe('/');
  });
});
