import { describe, expect, it, vi } from 'vitest';
import { normaliseApiBase, postSnooze, snoozeUrl } from './snoozeAction';
import { DELIVERY_ID, TOKEN } from './pushTestKit';

describe('snooze action', () => {
  it('normalises the API base like the app config', () => {
    expect(normaliseApiBase(undefined)).toBe('');
    expect(normaliseApiBase(' https://api.example.org// ')).toBe('https://api.example.org');
  });

  it('builds the delivery action URL (same origin without a base)', () => {
    expect(snoozeUrl('', DELIVERY_ID)).toBe(`/api/v1/push/deliveries/${DELIVERY_ID}/actions`);
    expect(snoozeUrl('https://api.example.org/', DELIVERY_ID)).toBe(
      `https://api.example.org/api/v1/push/deliveries/${DELIVERY_ID}/actions`,
    );
  });

  it('posts the token without credentials', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await expect(postSnooze(fetchFn, '', DELIVERY_ID, TOKEN)).resolves.toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`/api/v1/push/deliveries/${DELIVERY_ID}/actions`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(JSON.parse(init.body)).toEqual({ action: 'snooze', token: TOKEN });
  });

  it('reports failures without throwing', async () => {
    await expect(
      postSnooze(vi.fn().mockResolvedValue({ ok: false }), '', DELIVERY_ID, TOKEN),
    ).resolves.toBe(false);
    await expect(
      postSnooze(vi.fn().mockRejectedValue(new TypeError('offline')), '', DELIVERY_ID, TOKEN),
    ).resolves.toBe(false);
  });
});
