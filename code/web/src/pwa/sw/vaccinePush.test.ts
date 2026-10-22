import { describe, expect, it } from 'vitest';
import { clickTarget } from './clickTarget';
import {
  deepLinkUrl,
  linkOfMessage,
  linkOfPayload,
  linkPath,
  openMessageOf,
  parseDeepLinkHash,
  type NotificationLink,
} from './deepLink';
import { buildNotification, notificationTag } from './notificationOptions';
import { renderText } from './notificationText';
import { parsePayload, validatePayload } from './payload';
import { BABY_ID, DELIVERY_ID, TOKEN } from './pushTestKit';

/*
 * The vaccine_due push in the worker (docs/design/18-vaccines.md): codes and the schedule dose id
 * only, generic lock-screen text that never tells anybody to give a vaccine, the vaccine's name only
 * with show-names on, no action buttons (nothing to snooze), and a click that opens the baby's
 * vaccine schedule.
 */

const DOSE_ID = 'penta-1';
/** The reminder day at 09:00 in São Paulo. */
const AT = '2026-10-22T12:00:00Z';

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'vaccine_due',
  babyId: BABY_ID,
  doseId: DOSE_ID,
  at: AT,
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');
const text = (value: Record<string, unknown>) => renderText(parse(value));

describe('the vaccine_due payload', () => {
  it('accepts the schedule dose id and nothing more', () => {
    expect(parse(payload({ title: 'Pentavalent', vaccine: 'Pentavalent', notes: 'x' }))).toEqual({
      ok: true,
      payload: {
        id: DELIVERY_ID,
        kind: 'vaccine_due',
        babyId: BABY_ID,
        doseId: DOSE_ID,
        at: Date.parse(AT),
        lang: 'en',
        token: TOKEN,
      },
    });
  });

  it('needs a baby and a dose id in the shape of the schedule ids', () => {
    expect(parse(payload({ doseId: undefined })).ok).toBe(false);
    expect(parse(payload({ doseId: 'Penta 1' })).ok).toBe(false);
    expect(parse(payload({ doseId: '../penta-1' })).ok).toBe(false);
    expect(parse(payload({ doseId: 'a'.repeat(61) })).ok).toBe(false);
    expect(parse(payload({ doseId: 'a'.repeat(60) })).ok).toBe(true);
    expect(parse(payload({ babyId: 'nope' })).ok).toBe(false);
    expect(parse(payload({ at: 'tomorrow' })).ok).toBe(false);
  });

  it('keeps the baby and vaccine names only when they are well formed', () => {
    expect(parse(payload({ names: { baby: 'Lia', vaccine: 'Pentavalent' } }))).toMatchObject({
      payload: { names: { baby: 'Lia', vaccine: 'Pentavalent' } },
    });
    expect(parse(payload({ names: { baby: 'Lia' } }))).toMatchObject({
      payload: { names: { baby: 'Lia' } },
    });
    expect(parse(payload({ names: { baby: '   ', vaccine: 'Pentavalent' } }))).toMatchObject({
      payload: expect.not.objectContaining({ names: expect.anything() }),
    });
  });

  it('is tagged per baby and dose, has no action buttons and keeps the wire payload', () => {
    const parsed = validatePayload(payload());
    if (!parsed.ok) throw new Error('expected a valid payload');
    const shown = buildNotification(parsed);

    expect(notificationTag(parsed.payload)).toBe(
      'vaccine:7c9e6679742540de944be07fc1f90ae7:penta-1',
    );
    expect(shown.options.tag).toBe('vaccine:7c9e6679742540de944be07fc1f90ae7:penta-1');
    expect(shown.options.actions).toBeUndefined();
    expect(shown.options.renotify).toBe(false);
    expect(shown.options.timestamp).toBe(Date.parse(AT));
    expect(validatePayload(shown.options.data)).toEqual(parsed);
  });
});

describe('vaccine reminder text', () => {
  it('is generic without names, in English and Portuguese', () => {
    expect(text(payload())).toEqual({
      title: 'A vaccine may be due',
      body: 'Open Lotties to see the vaccine schedule.',
    });
    expect(text(payload({ lang: 'pt-BR' }))).toEqual({
      title: 'Pode haver uma vacina a tomar',
      body: 'Abra o Lotties para ver o calendário de vacinas.',
    });
  });

  it('names the baby and the vaccine with show names on', () => {
    const names = { baby: 'Lia', vaccine: 'Pentavalent' };
    expect(text(payload({ names })).body).toBe(
      'Lia: Pentavalent may be due according to the schedule.',
    );
    expect(
      text(payload({ lang: 'pt-BR', names: { baby: 'Lia', vaccine: 'Pentavalente' } })).body,
    ).toBe('Lia: Pentavalente pode estar na época, segundo o calendário.');
  });

  it('names only the baby when the payload has no vaccine name', () => {
    expect(text(payload({ names: { baby: 'Lia' } })).body).toBe(
      'Lia: a vaccine may be due according to the schedule.',
    );
    expect(text(payload({ lang: 'pt-BR', names: { baby: 'Lia' } })).body).toBe(
      'Lia: pode haver uma vacina a tomar, segundo o calendário.',
    );
  });

  it('never shows a raw code for a payload it cannot read', () => {
    const shown = text(payload({ doseId: undefined, lang: 'pt-BR' }));
    expect(shown).toEqual({ title: 'Lotties', body: 'Abra o app para ver os detalhes.' });
  });
});

describe('opening a vaccine reminder', () => {
  const link: NotificationLink = { kind: 'vaccine', babyId: BABY_ID, deliveryId: DELIVERY_ID };
  const path = `/vaccines#notify=vaccine&baby=${BABY_ID}&d=${DELIVERY_ID}`;

  it('opens the vaccines page for the baby, whichever button was pressed', () => {
    for (const action of ['', 'open', 'snooze']) {
      expect(clickTarget(payload(), action)).toEqual({
        type: 'open',
        path,
        message: {
          type: 'notification-open',
          kind: 'vaccine_due',
          babyId: BABY_ID,
          deliveryId: DELIVERY_ID,
        },
      });
    }
  });

  it('round-trips the deep link and the message to an open window', () => {
    const parsed = validatePayload(payload());
    if (!parsed.ok) throw new Error('expected a valid payload');
    expect(linkOfPayload(parsed.payload)).toEqual(link);
    expect(linkPath(link)).toBe('/vaccines');
    expect(deepLinkUrl(link)).toBe(path);
    expect(parseDeepLinkHash(path.slice(path.indexOf('#')))).toEqual(link);
    expect(linkOfMessage(openMessageOf(link))).toEqual(link);
  });

  it('rejects a link without a valid baby or delivery', () => {
    expect(parseDeepLinkHash(`#notify=vaccine&baby=${BABY_ID}`)).toBeNull();
    expect(parseDeepLinkHash(`#notify=vaccine&baby=nope&d=${DELIVERY_ID}`)).toBeNull();
  });
});
