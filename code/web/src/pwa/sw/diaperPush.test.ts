import { describe, expect, it } from 'vitest';
import { clickTarget } from './clickTarget';
import {
  deepLinkUrl,
  linkOfMessage,
  openMessageOf,
  parseDeepLinkHash,
  type NotificationLink,
} from './deepLink';
import { buildNotification, notificationTag } from './notificationOptions';
import { renderText } from './notificationText';
import { parsePayload, validatePayload } from './payload';
import { BABY_ID, DELIVERY_ID, dirtyPayload, TOKEN, wetPayload } from './pushTestKit';

/*
 * The diaper heads-ups in the worker (docs/design/09-push-notifications.md section 2.8): codes
 * only in the payload, gentle generic text from the bundled catalogs, Now as the click target.
 */

const SAO_PAULO = 'America/Sao_Paulo';
const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');

describe.each([
  ['diaper_wet_headsup', wetPayload, Date.UTC(2026, 9, 21, 18, 40), 'wet'],
  ['diaper_dirty_headsup', dirtyPayload, Date.UTC(2026, 9, 21, 19, 5), 'dirty'],
] as const)('the %s payload', (kind, payload, at, linkKind) => {
  it('accepts the codes-only payload and needs a baby', () => {
    expect(parse(payload())).toEqual({
      ok: true,
      payload: { id: DELIVERY_ID, kind, babyId: BABY_ID, at, lang: 'en', token: TOKEN },
    });
    expect(parse(payload({ babyId: undefined })).ok).toBe(false);
  });

  it('ignores fields it does not know (no content or advice is ever read)', () => {
    const parsed = parse(payload({ content: 'DIRTY', advice: 'see a doctor', rxId: 'x' }));
    expect(parsed.ok && Object.keys(parsed.payload).sort()).toEqual([
      'at',
      'babyId',
      'id',
      'kind',
      'lang',
      'token',
    ]);
  });

  it('is tagged per baby and kind, has no action buttons and keeps the wire payload', () => {
    const shown = buildNotification(parse(payload()), SAO_PAULO);
    const parsed = validatePayload(payload());
    if (!parsed.ok) throw new Error('expected a valid payload');
    const tag = `${linkKind}:7c9e6679742540de944be07fc1f90ae7`;
    expect(notificationTag(parsed.payload)).toBe(tag);
    expect(shown.options.tag).toBe(tag);
    expect(shown.options.actions).toBeUndefined();
    expect(validatePayload(shown.options.data)).toEqual(parsed);
  });

  it('opens Now for the baby on click and round-trips the deep link', () => {
    const link: NotificationLink = { kind: linkKind, babyId: BABY_ID, deliveryId: DELIVERY_ID };
    for (const action of ['', 'open', 'snooze']) {
      expect(clickTarget(payload(), action)).toEqual({
        type: 'open',
        path: `/#notify=${linkKind}&baby=${BABY_ID}&d=${DELIVERY_ID}`,
        message: { type: 'notification-open', kind, babyId: BABY_ID, deliveryId: DELIVERY_ID },
      });
    }
    expect(parseDeepLinkHash(deepLinkUrl(link).slice(1))).toEqual(link);
    expect(linkOfMessage(openMessageOf(link))).toEqual(link);
  });
});

describe('diaper heads-up text', () => {
  it('shows gentle generic text in English and Portuguese', () => {
    expect(renderText(parse(wetPayload()), SAO_PAULO)).toEqual({
      title: 'A diaper check may be due',
      body: expect.stringMatching(/^A wet diaper is often due around 03:40\sPM\.$/),
    });
    expect(renderText(parse(wetPayload({ lang: 'pt-BR' })), SAO_PAULO)).toEqual({
      title: 'Pode ser hora de olhar a fralda',
      body: 'Uma fralda molhada costuma vir por volta de 15:40.',
    });
    expect(renderText(parse(dirtyPayload()), SAO_PAULO)).toEqual({
      title: 'A diaper may be coming',
      body: expect.stringMatching(/^A dirty diaper often comes around 04:05\sPM\.$/),
    });
    expect(renderText(parse(dirtyPayload({ lang: 'pt-BR' })), SAO_PAULO)).toEqual({
      title: 'Uma fralda suja pode estar a caminho',
      body: 'Uma fralda suja costuma vir por volta de 16:05.',
    });
  });

  it('names the baby only when the payload carries names (show names on)', () => {
    expect(
      renderText(parse(wetPayload({ lang: 'pt-BR', names: { baby: 'Lia' } })), SAO_PAULO).body,
    ).toBe('Lia: uma fralda molhada costuma vir por volta de 15:40.');
    expect(renderText(parse(dirtyPayload({ names: { baby: 'Lia' } })), SAO_PAULO).body).toMatch(
      /^Lia: a dirty diaper often comes around 04:05\sPM\.$/,
    );
  });

  it('is calm and gender-neutral: no alarm, no condition, no he or she', () => {
    for (const payload of [wetPayload, dirtyPayload]) {
      for (const lang of ['en', 'pt-BR']) {
        const { title, body } = renderText(parse(payload({ lang })), SAO_PAULO);
        expect(`${title} ${body}`).not.toMatch(
          /doctor|médic|urgent|urgente|dehydrat|desidrat|!|\b(he|she|his|her|ele|ela|dele|dela)\b/i,
        );
      }
    }
  });
});
