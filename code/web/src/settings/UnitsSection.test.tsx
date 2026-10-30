import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import { I18nProvider } from '../i18n/I18nProvider';
import { activateLocale } from '../i18n/i18n';
import { fakeApi, httpError, networkError, type ApiCall } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { useTestLocale } from '../test/locale';
import { setDeviceLocaleTag, setUnitSetting } from '../units/state';
import { loadUnitSetting, storeUnitSetting } from '../units/unitSettingStorage';
import { UnitsProvider } from '../units/UnitsProvider';
import { useUnits } from '../units/useUnits';
import { UnitsSection } from './UnitsSection';

const PATH = '/api/v1/me/unit-settings';

function Probe() {
  const units = useUnits();
  return <p data-testid="probe">{units.formatVolume(120)}</p>;
}

function renderUnits(handler: (call: ApiCall) => unknown = () => undefined) {
  const fake = fakeApi(handler);
  const view = render(
    <I18nProvider>
      <AuthContext value={fakeAuth()}>
        <ApiClientContext value={fake.api}>
          <MemoryRouter>
            <UnitsProvider>
              <UnitsSection />
              <Probe />
            </UnitsProvider>
          </MemoryRouter>
        </ApiClientContext>
      </AuthContext>
    </I18nProvider>,
  );
  return { ...fake, ...view };
}

const unitCalls = (calls: ApiCall[]) => calls.filter((c) => c.path === PATH);

beforeEach(() => {
  window.localStorage.clear();
  setUnitSetting('auto');
  setDeviceLocaleTag('pt-BR');
});

afterEach(async () => {
  setDeviceLocaleTag('en-GB');
  setUnitSetting('auto');
  await activateLocale('en');
});

describe('Units settings', () => {
  it('offers automatic, metric and US customary with an example each', async () => {
    renderUnits();
    expect(await screen.findByRole('radio', { name: /Automatic/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Metric/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /US customary/ })).toBeTruthy();
    expect(screen.getByText(/Follows this device's region. Now: metric./)).toBeTruthy();
    expect(screen.getByText('e.g. 120 ml, 3.5 kg, 50 cm, 37 °C')).toBeTruthy();
    expect(screen.getByText('e.g. 4.1 fl oz, 7 lb 11 oz, 19.7 in, 98.6 °F')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Automatic/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('automatic follows the device region, not the language', async () => {
    setDeviceLocaleTag('en-US');
    renderUnits();
    expect(await screen.findByText(/Now: US customary/)).toBeTruthy();
    expect(screen.getByTestId('probe').textContent).toBe('4.1 fl oz');
  });

  it('writes the choice through to the server and to this account on the device', async () => {
    const { calls } = renderUnits();
    fireEvent.click(await screen.findByRole('radio', { name: /US customary/ }));

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('4.1 fl oz'));
    await waitFor(() => expect(unitCalls(calls).some((c) => c.method === 'PUT')).toBe(true));
    expect(unitCalls(calls).find((c) => c.method === 'PUT')!.body).toEqual({ system: 'us' });
    expect(loadUnitSetting()).toEqual({ system: 'us', pending: false });
  });

  it('keeps the local choice and retries when the server fails or has no route', async () => {
    let failing = true;
    const { calls } = renderUnits((call) => {
      if (call.path === PATH && call.method === 'PUT' && failing) throw httpError(404);
      if (call.path === PATH && call.method === 'GET') throw networkError();
      return undefined;
    });
    fireEvent.click(await screen.findByRole('radio', { name: /^Metric/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /US customary/ }));

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('4.1 fl oz'));
    await waitFor(() => expect(unitCalls(calls).some((c) => c.method === 'PUT')).toBe(true));
    expect(loadUnitSetting()).toEqual({ system: 'us', pending: true });
    expect(await screen.findByRole('status')).toBeTruthy();

    failing = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(loadUnitSetting().pending).toBe(false));
    expect(loadUnitSetting().system).toBe('us');
  });

  it('adopts the server value on load, and sends an unconfirmed local one instead', async () => {
    renderUnits((call) =>
      call.path === PATH && call.method === 'GET' ? { system: 'us' } : undefined,
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('4.1 fl oz'));
    expect(loadUnitSetting()).toEqual({ system: 'us', pending: false });
  });

  it('sends a pending local choice on load and ignores the older server value', async () => {
    storeUnitSetting('metric', true);
    const { calls } = renderUnits((call) =>
      call.path === PATH && call.method === 'GET' ? { system: 'us' } : undefined,
    );
    await waitFor(() => expect(unitCalls(calls).some((c) => c.method === 'PUT')).toBe(true));
    expect(unitCalls(calls).find((c) => c.method === 'PUT')!.body).toEqual({ system: 'metric' });
    expect(screen.getByTestId('probe').textContent).toBe('120 ml');
  });

  it('is in Portuguese too', async () => {
    await useTestLocale('pt-BR');
    renderUnits();
    expect(await screen.findByRole('radio', { name: /Automático/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Americano/ })).toBeTruthy();
    expect(screen.getByText('ex.: 4,1 fl oz, 7 lb 11 oz, 19,7 pol., 98,6 °F')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Americano/ }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('4,1 fl oz'));
  });
});
