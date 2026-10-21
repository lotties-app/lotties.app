import { describe, expect, it } from 'vitest';
import { clickTarget } from './clickTarget';
import {
  BABY_ID,
  DELIVERY_ID,
  dosePayload,
  napPayload,
  RX_ID,
  testPayload,
  TOKEN,
} from './pushTestKit';

describe('notification click target', () => {
  it('snoozes a dose with a token', () => {
    expect(clickTarget(dosePayload(), 'snooze')).toEqual({
      type: 'snooze',
      deliveryId: DELIVERY_ID,
      token: TOKEN,
    });
  });

  it('opens the dose deep link on the body or Open', () => {
    for (const action of ['', 'open', 'unknown']) {
      expect(clickTarget(dosePayload(), action)).toEqual({
        type: 'open',
        path: `/#notify=dose&baby=${BABY_ID}&rx=${RX_ID}&d=${DELIVERY_ID}&t=${TOKEN}`,
        message: {
          type: 'notification-open',
          kind: 'dose_due',
          babyId: BABY_ID,
          rxId: RX_ID,
          deliveryId: DELIVERY_ID,
          token: TOKEN,
        },
      });
    }
  });

  it('opens instead of snoozing when the dose has no token', () => {
    const target = clickTarget(dosePayload({ token: undefined }), 'snooze');
    expect(target).toMatchObject({
      type: 'open',
      path: `/#notify=dose&baby=${BABY_ID}&rx=${RX_ID}&d=${DELIVERY_ID}`,
    });
  });

  it('opens Now for a nap and the app root for a test', () => {
    expect(clickTarget(napPayload(), '')).toMatchObject({
      type: 'open',
      path: `/#notify=nap&baby=${BABY_ID}&d=${DELIVERY_ID}`,
      message: { kind: 'nap_window', babyId: BABY_ID },
    });
    expect(clickTarget(testPayload(), 'snooze')).toEqual({ type: 'open', path: '/' });
  });

  it('never follows a URL or path from the data', () => {
    for (const data of [
      { ...dosePayload(), url: 'https://evil.example/' },
      { ...dosePayload(), babyId: '//evil.example' },
      'https://evil.example/',
      null,
      undefined,
    ]) {
      const target = clickTarget(data, '');
      expect(target.type).toBe('open');
      if (target.type === 'open')
        expect(target.path.startsWith('/') && !target.path.startsWith('//')).toBe(true);
      expect(JSON.stringify(target)).not.toContain('evil');
    }
  });
});
