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
 * The doctor_suggestion push in the worker (docs/design/16-doctor-access.md section 10.4): codes and
 * ids only (a proposal or a note, never both), generic lock-screen text that never names the medicine
 * or quotes the note, only the Open action (no snooze), and a click that opens "From your doctor".
 */

const PROPOSAL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const NOTE_ID = '9b2c1e5a-7a0f-4c3d-8a55-52a4c7f8d012';
const CREATED = '2026-10-22T13:00:00Z';

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'doctor_suggestion',
  babyId: BABY_ID,
  proposalId: PROPOSAL_ID,
  at: CREATED,
  lang: 'en',
  ...overrides,
});

const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');

describe('the doctor_suggestion payload', () => {
  it('accepts a proposal id or a note id and keeps nothing else', () => {
    expect(parse(payload({ medication: 'Colidis', body: 'Offer 120 ml' }))).toEqual({
      ok: true,
      payload: {
        id: DELIVERY_ID,
        kind: 'doctor_suggestion',
        babyId: BABY_ID,
        proposalId: PROPOSAL_ID,
        at: Date.parse(CREATED),
        lang: 'en',
      },
    });
    expect(parse(payload({ proposalId: undefined, noteId: NOTE_ID }))).toMatchObject({
      ok: true,
      payload: { kind: 'doctor_suggestion', noteId: NOTE_ID },
    });
  });

  it('needs exactly one of the two ids, as GUIDs, and a baby', () => {
    expect(parse(payload({ proposalId: undefined })).ok).toBe(false);
    expect(parse(payload({ noteId: NOTE_ID })).ok).toBe(false);
    expect(parse(payload({ proposalId: 'colidis' })).ok).toBe(false);
    expect(parse(payload({ babyId: undefined })).ok).toBe(false);
    expect(parse(payload({ at: 'yesterday' })).ok).toBe(false);
  });

  it('carries the names only when they are well formed', () => {
    expect(parse(payload({ names: { baby: 'Lia' } }))).toMatchObject({
      payload: { names: { baby: 'Lia' } },
    });
    expect(parse(payload({ names: { baby: '   ' } }))).toMatchObject({
      payload: expect.not.objectContaining({ names: expect.anything() }),
    });
  });

  it('survives the round trip through the notification data', () => {
    const parsed = validatePayload(payload({ proposalId: undefined, noteId: NOTE_ID }));
    if (!parsed.ok) throw new Error('expected a valid payload');
    const shown = buildNotification(parsed);

    expect(validatePayload(shown.options.data)).toEqual(parsed);
  });
});

describe('the doctor_suggestion text', () => {
  it('is generic in English and Portuguese, whatever the suggestion is', () => {
    expect(renderText(parse(payload()))).toEqual({
      title: 'Your doctor sent a suggestion',
      body: 'Open Lotties to review it.',
    });
    expect(
      renderText(parse(payload({ lang: 'pt-BR', noteId: NOTE_ID, proposalId: undefined }))),
    ).toEqual({
      title: 'Seu médico enviou uma sugestão',
      body: 'Abra o Lotties para ver.',
    });
  });

  it('names the baby only with show names on, and never a medicine or a note', () => {
    expect(renderText(parse(payload({ names: { baby: 'Lia' } }))).body).toBe(
      'Lia: open Lotties to review it.',
    );
    expect(renderText(parse(payload({ lang: 'pt-BR', names: { baby: 'Lia' } }))).body).toBe(
      'Lia: abra o Lotties para ver.',
    );
    const text = renderText(parse(payload({ names: { baby: 'Lia', medication: 'Colidis' } })));
    expect(JSON.stringify(text)).not.toMatch(/Colidis/);
  });
});

describe('the doctor_suggestion notification', () => {
  it('is tagged per suggestion and offers no snooze action, even with a token', () => {
    const parsed = validatePayload(payload({ token: TOKEN }));
    if (!parsed.ok) throw new Error('expected a valid payload');
    const shown = buildNotification(parsed);

    expect(notificationTag(parsed.payload)).toBe('doctor:3f2504e04f8941d39a0c0305e82c3301');
    expect(shown.options.tag).toBe('doctor:3f2504e04f8941d39a0c0305e82c3301');
    expect(shown.options.actions).toBeUndefined();
    expect(shown.options.renotify).toBe(false);
  });

  it('uses the note id for the tag of a recommendation', () => {
    const parsed = validatePayload(payload({ proposalId: undefined, noteId: NOTE_ID }));
    if (!parsed.ok) throw new Error('expected a valid payload');

    expect(notificationTag(parsed.payload)).toBe('doctor:9b2c1e5a7a0f4c3d8a5552a4c7f8d012');
  });
});

describe('the doctor_suggestion click', () => {
  const link: NotificationLink = { kind: 'doctor', babyId: BABY_ID, deliveryId: DELIVERY_ID };
  const path = `/from-doctor#notify=doctor&baby=${BABY_ID}&d=${DELIVERY_ID}`;

  it('opens "From your doctor" for the body and any action, never snoozing', () => {
    for (const action of ['', 'open', 'snooze']) {
      expect(clickTarget(payload({ token: TOKEN }), action)).toEqual({
        type: 'open',
        path,
        message: {
          type: 'notification-open',
          kind: 'doctor_suggestion',
          babyId: BABY_ID,
          deliveryId: DELIVERY_ID,
        },
      });
    }
  });

  it('round-trips the deep link and the worker message', () => {
    const parsed = validatePayload(payload());
    if (!parsed.ok) throw new Error('expected a valid payload');

    expect(linkOfPayload(parsed.payload)).toEqual(link);
    expect(linkPath(link)).toBe('/from-doctor');
    expect(deepLinkUrl(link)).toBe(path);
    expect(parseDeepLinkHash(path.slice(path.indexOf('#')))).toEqual(link);
    expect(linkOfMessage(openMessageOf(link))).toEqual(link);
  });

  it('refuses a link without a valid baby or delivery id', () => {
    expect(parseDeepLinkHash(`#notify=doctor&baby=nope&d=${DELIVERY_ID}`)).toBeNull();
    expect(parseDeepLinkHash(`#notify=doctor&baby=${BABY_ID}`)).toBeNull();
    expect(linkOfMessage({ type: 'notification-open', kind: 'doctor_suggestion' })).toBeNull();
  });
});
