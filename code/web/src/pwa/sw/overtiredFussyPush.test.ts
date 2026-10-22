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
import { BABY_ID, DELIVERY_ID, fussyPayload, overtiredPayload, TOKEN } from './pushTestKit';

/*
 * The overtired and fussy pattern heads-ups in the worker (docs/design/09-push-notifications.md
 * sections 2.6 and 2.7): codes only in the payload, generic text from the bundled catalogs, Now as
 * the click target.
 */

const SAO_PAULO = 'America/Sao_Paulo';
const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');

describe.each([
  ['overtired_warning', overtiredPayload, Date.UTC(2026, 9, 21, 18, 30), 'overtired'],
  ['fussy_pattern', fussyPayload, Date.UTC(2026, 9, 21, 20, 30), 'fussy'],
] as const)('the %s payload', (kind, payload, at, linkKind) => {
  it('accepts the codes-only payload and needs a baby', () => {
    expect(parse(payload())).toEqual({
      ok: true,
      payload: { id: DELIVERY_ID, kind, babyId: BABY_ID, at, lang: 'en', token: TOKEN },
    });
    expect(parse(payload({ babyId: undefined })).ok).toBe(false);
  });

  it('ignores fields it does not know (no symptom or advice is ever read)', () => {
    const parsed = parse(payload({ crying: 'intense', advice: 'see a doctor', rxId: 'x' }));
    expect(parsed.ok && Object.keys(parsed.payload).sort()).toEqual([
      'at',
      'babyId',
      'id',
      'kind',
      'lang',
      'token',
    ]);
  });

  it('is tagged per baby, has no action buttons and keeps the wire payload', () => {
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

describe('overtired and fussy heads-up text', () => {
  it('shows calm generic text in English and Portuguese', () => {
    expect(renderText(parse(overtiredPayload()), SAO_PAULO)).toEqual({
      title: 'Awake time is near the usual limit',
      body: expect.stringMatching(/^The usual limit is around 03:30\sPM\. A nap soon may help\.$/),
    });
    expect(renderText(parse(overtiredPayload({ lang: 'pt-BR' })), SAO_PAULO)).toEqual({
      title: 'Tempo acordado perto do limite de costume',
      body: 'O limite de costume é por volta de 15:30. Uma soneca em breve pode ajudar.',
    });
    expect(renderText(parse(fussyPayload()), SAO_PAULO)).toEqual({
      title: 'Fussy time is coming up',
      body: expect.stringMatching(
        /^Fussiness often starts from around 05:30\sPM\. A calm routine may help\.$/,
      ),
    });
    expect(renderText(parse(fussyPayload({ lang: 'pt-BR' })), SAO_PAULO)).toEqual({
      title: 'A hora do choro está chegando',
      body: 'A irritação costuma começar a partir de 17:30. Uma rotina calma pode ajudar.',
    });
  });

  it('names the baby only when the payload carries names (show names on)', () => {
    expect(
      renderText(parse(overtiredPayload({ lang: 'pt-BR', names: { baby: 'Lia' } })), SAO_PAULO)
        .body,
    ).toBe('Lia: o limite de costume é por volta de 15:30. Uma soneca em breve pode ajudar.');
    expect(renderText(parse(fussyPayload({ names: { baby: 'Lia' } })), SAO_PAULO).body).toMatch(
      /^Lia: fussiness often starts from around 05:30\sPM\.$/,
    );
  });

  it('never says crying is a problem or names a condition', () => {
    for (const payload of [overtiredPayload, fussyPayload]) {
      for (const lang of ['en', 'pt-BR']) {
        const { title, body } = renderText(parse(payload({ lang })), SAO_PAULO);
        expect(`${title} ${body}`).not.toMatch(/colic|cólica|doctor|médic|urgent|urgente|!/i);
      }
    }
  });
});
