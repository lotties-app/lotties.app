import { describe, expect, it } from 'vitest';
import { clickTarget } from './clickTarget';
import { deepLinkUrl, linkOfMessage, parseDeepLinkHash, type NotificationLink } from './deepLink';
import { buildNotification, notificationTag } from './notificationOptions';
import { renderText } from './notificationText';
import { parsePayload, validatePayload } from './payload';
import { BABY_ID, bellyPayload, DELIVERY_ID, TOKEN } from './pushTestKit';

/*
 * The belly pain pattern heads-up in the worker (docs/design/09-push-notifications.md section 2.5):
 * codes only in the payload, generic text from the bundled catalog, Now as the click target.
 */

const SAO_PAULO = 'America/Sao_Paulo';
const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');
const belly: NotificationLink = { kind: 'belly', babyId: BABY_ID, deliveryId: DELIVERY_ID };

describe('belly pain heads-up payload', () => {
  it('accepts the codes-only payload', () => {
    expect(parse(bellyPayload())).toEqual({
      ok: true,
      payload: {
        id: DELIVERY_ID,
        kind: 'belly_pain_pattern',
        babyId: BABY_ID,
        at: Date.UTC(2026, 9, 21, 20, 30),
        lang: 'en',
        token: TOKEN,
      },
    });
  });

  it('needs a baby and ignores fields it does not know (no medical details are read)', () => {
    expect(parse(bellyPayload({ babyId: undefined })).ok).toBe(false);
    const parsed = parse(bellyPayload({ intensity: 5, rxId: 'x', advice: 'give medicine' }));
    expect(parsed.ok && Object.keys(parsed.payload).sort()).toEqual([
      'at',
      'babyId',
      'id',
      'kind',
      'lang',
      'token',
    ]);
  });
});

describe('belly pain heads-up text', () => {
  it('shows generic text in English and Portuguese', () => {
    expect(renderText(parse(bellyPayload()), SAO_PAULO)).toEqual({
      title: 'A good moment for a belly massage',
      body: expect.stringMatching(/^Belly pain often shows up from around 05:30\sPM\.$/),
    });
    expect(renderText(parse(bellyPayload({ lang: 'pt-BR' })), SAO_PAULO)).toEqual({
      title: 'Hora de uma massagem na barriguinha',
      body: 'A dor de barriga costuma aparecer a partir de 17:30.',
    });
  });

  it('names the baby only when the payload carries names (show names on)', () => {
    const named = parse(bellyPayload({ lang: 'pt-BR', names: { baby: 'Lia' } }));
    expect(renderText(named, SAO_PAULO).body).toBe(
      'Lia: a dor de barriga costuma aparecer a partir de 17:30.',
    );
  });
});

describe('belly pain heads-up notification', () => {
  it('is tagged per baby, has no action buttons and keeps the wire payload', () => {
    const shown = buildNotification(parse(bellyPayload()), SAO_PAULO);
    const parsed = validatePayload(bellyPayload());
    if (!parsed.ok) throw new Error('expected a valid payload');
    expect(notificationTag(parsed.payload)).toBe('belly:7c9e6679742540de944be07fc1f90ae7');
    expect(shown.options.tag).toBe('belly:7c9e6679742540de944be07fc1f90ae7');
    expect(shown.options.actions).toBeUndefined();
    expect(validatePayload(shown.options.data)).toEqual(parsed);
  });

  it('opens Now for the baby on click, also from the Snooze action', () => {
    for (const action of ['', 'open', 'snooze']) {
      expect(clickTarget(bellyPayload(), action)).toEqual({
        type: 'open',
        path: `/#notify=belly&baby=${BABY_ID}&d=${DELIVERY_ID}`,
        message: {
          type: 'notification-open',
          kind: 'belly_pain_pattern',
          babyId: BABY_ID,
          deliveryId: DELIVERY_ID,
        },
      });
    }
  });

  it('round-trips the deep link as a URL and as a worker message', () => {
    expect(parseDeepLinkHash(deepLinkUrl(belly).slice(1))).toEqual(belly);
    const target = clickTarget(bellyPayload(), '');
    if (target.type !== 'open') throw new Error('expected open');
    expect(linkOfMessage(target.message)).toEqual(belly);
    expect(linkOfMessage({ ...target.message, kind: 'toString' })).toBeNull();
  });
});
