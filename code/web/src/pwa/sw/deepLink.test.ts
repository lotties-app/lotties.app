import { describe, expect, it } from 'vitest';
import { clickTarget } from './clickTarget';
import { deepLinkUrl, linkOfMessage, parseDeepLinkHash, type NotificationLink } from './deepLink';
import { BABY_ID, DELIVERY_ID, dosePayload, napPayload, RX_ID, TOKEN } from './pushTestKit';

const dose: NotificationLink = {
  kind: 'dose',
  babyId: BABY_ID,
  rxId: RX_ID,
  deliveryId: DELIVERY_ID,
  token: TOKEN,
};
const nap: NotificationLink = { kind: 'nap', babyId: BABY_ID, deliveryId: DELIVERY_ID };

describe('notification deep link', () => {
  it('round-trips the URL the worker opens', () => {
    for (const link of [dose, nap, { ...dose, token: undefined }]) {
      const expected = JSON.parse(JSON.stringify(link)) as NotificationLink;
      const url = deepLinkUrl(link);
      expect(url.startsWith('/#notify=')).toBe(true);
      expect(parseDeepLinkHash(url.slice(1))).toEqual(expected);
    }
  });

  it('reads what the worker builds from a click, as a URL and as a message', () => {
    const target = clickTarget(dosePayload(), '');
    if (target.type !== 'open') throw new Error('expected open');
    expect(parseDeepLinkHash(target.path.slice(1))).toEqual(dose);
    expect(linkOfMessage(target.message)).toEqual(dose);
    const napTarget = clickTarget(napPayload(), '');
    if (napTarget.type !== 'open') throw new Error('expected open');
    expect(linkOfMessage(napTarget.message)).toEqual(nap);
  });

  it('rejects anything that is not validated ids and token', () => {
    for (const hash of [
      '',
      '#',
      '#members',
      '#notify=dose',
      `#notify=dose&baby=${BABY_ID}&d=${DELIVERY_ID}`,
      `#notify=dose&baby=../x&rx=${RX_ID}&d=${DELIVERY_ID}`,
      `#notify=other&baby=${BABY_ID}&d=${DELIVERY_ID}`,
      `#notify=nap&baby=${BABY_ID}&d=https://evil.example`,
    ]) {
      expect(parseDeepLinkHash(hash)).toBeNull();
    }
    expect(
      parseDeepLinkHash(`#notify=dose&baby=${BABY_ID}&rx=${RX_ID}&d=${DELIVERY_ID}&t=a b`),
    ).toEqual({ kind: 'dose', babyId: BABY_ID, rxId: RX_ID, deliveryId: DELIVERY_ID });
  });

  it('upper-case ids are normalised', () => {
    const link = parseDeepLinkHash(`#notify=nap&baby=${BABY_ID.toUpperCase()}&d=${DELIVERY_ID}`);
    expect(link).toEqual(nap);
  });

  it('ignores foreign or malformed messages', () => {
    for (const data of [
      null,
      'notification-open',
      { type: 'SKIP_WAITING' },
      { type: 'notification-open', kind: 'test', deliveryId: DELIVERY_ID },
      { type: 'notification-open', kind: 'dose_due', babyId: BABY_ID, deliveryId: DELIVERY_ID },
    ]) {
      expect(linkOfMessage(data)).toBeNull();
    }
  });
});
