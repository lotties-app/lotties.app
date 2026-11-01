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
import { appointmentPhrase, renderText } from './notificationText';
import { parsePayload, validatePayload } from './payload';
import { BABY_ID, DELIVERY_ID, TOKEN } from './pushTestKit';

/*
 * Appointment reminders in the worker (docs/design/15-appointments.md, docs/design/09 section
 * 2.9): codes, the appointment id, its start and the offset only; the wording ("tomorrow at
 * 15:30", "in 2 hours") is made here in the device zone; a click opens the appointment's detail.
 */

const SAO_PAULO = 'America/Sao_Paulo';
const APPT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
/** Thursday 22 October 2026, 15:30 in São Paulo. */
const START = '2026-10-22T18:30:00Z';
const START_MS = Date.parse(START);
const MINUTE = 60_000;

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'appointment_reminder',
  babyId: BABY_ID,
  apptId: APPT_ID,
  offset: 1440,
  at: START,
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');
const textAt = (value: Record<string, unknown>, minutesBefore: number) =>
  renderText(parse(value), SAO_PAULO, START_MS - minutesBefore * MINUTE);

describe('the appointment_reminder payload', () => {
  it('accepts the appointment id and a known offset, nothing more', () => {
    const parsed = parse(payload({ title: 'Pediatrician', doctor: 'Dr. Ana', notes: 'x' }));

    expect(parsed).toEqual({
      ok: true,
      payload: {
        id: DELIVERY_ID,
        kind: 'appointment_reminder',
        babyId: BABY_ID,
        apptId: APPT_ID,
        offset: 1440,
        at: START_MS,
        lang: 'en',
        token: TOKEN,
      },
    });
    expect(parse(payload({ apptId: undefined })).ok).toBe(false);
    expect(parse(payload({ offset: 60 })).ok).toBe(false);
    expect(parse(payload({ babyId: 'nope' })).ok).toBe(false);
  });

  it('is tagged per appointment, has no action buttons and keeps the wire payload', () => {
    const parsed = validatePayload(payload());
    if (!parsed.ok) throw new Error('expected a valid payload');
    const shown = buildNotification(parsed, SAO_PAULO, START_MS - 1440 * MINUTE);

    expect(notificationTag(parsed.payload)).toBe('appt:3f2504e04f8941d39a0c0305e82c3301');
    expect(shown.options.tag).toBe('appt:3f2504e04f8941d39a0c0305e82c3301');
    expect(shown.options.actions).toBeUndefined();
    expect(validatePayload(shown.options.data)).toEqual(parsed);
  });

  it('opens the appointment on the calendar page and round-trips the deep link', () => {
    const link: NotificationLink = {
      kind: 'appt',
      babyId: BABY_ID,
      appointmentId: APPT_ID,
      deliveryId: DELIVERY_ID,
    };
    const path = `/appointments#notify=appt&baby=${BABY_ID}&appt=${APPT_ID}&d=${DELIVERY_ID}`;

    for (const action of ['', 'open', 'snooze']) {
      expect(clickTarget(payload(), action)).toEqual({
        type: 'open',
        path,
        message: {
          type: 'notification-open',
          kind: 'appointment_reminder',
          babyId: BABY_ID,
          appointmentId: APPT_ID,
          deliveryId: DELIVERY_ID,
        },
      });
    }
    expect(deepLinkUrl(link)).toBe(path);
    expect(parseDeepLinkHash(path.slice(path.indexOf('#')))).toEqual(link);
    expect(linkOfMessage(openMessageOf(link))).toEqual(link);
    expect(parseDeepLinkHash(`#notify=appt&baby=${BABY_ID}&d=${DELIVERY_ID}`)).toBeNull();
  });
});

describe('appointment reminder text', () => {
  it('says when, in English and Portuguese, from the offset', () => {
    expect(textAt(payload(), 1440)).toEqual({
      title: 'Appointment reminder',
      body: expect.stringMatching(/^Appointment tomorrow at 03:30\sPM\.$/),
    });
    expect(textAt(payload({ lang: 'pt-BR' }), 1440)).toEqual({
      title: 'Lembrete de consulta',
      body: 'Consulta amanhã às 15:30.',
    });
    expect(textAt(payload({ lang: 'pt-BR', offset: 120 }), 120).body).toBe(
      'Consulta daqui a 2 horas, às 15:30.',
    );
    expect(textAt(payload({ lang: 'pt-BR', offset: 30 }), 30).body).toBe(
      'Consulta daqui a 30 minutos, às 15:30.',
    );
    expect(textAt(payload({ lang: 'pt-BR', offset: 10080 }), 10080).body).toBe(
      'Consulta daqui a uma semana, quinta-feira, 22 de outubro, às 15:30.',
    );
    expect(textAt(payload({ offset: 10080 }), 10080).body).toMatch(
      /^Appointment in a week, on Thursday, October 22 at 03:30\sPM\.$/,
    );
    expect(textAt(payload({ offset: 120 }), 120).body).toMatch(
      /^Appointment in 2 hours, at 03:30\sPM\.$/,
    );
  });

  it('falls back to the calendar wording when quiet hours delayed it', () => {
    expect(textAt(payload({ lang: 'pt-BR', offset: 120 }), 60).body).toBe(
      'Consulta hoje às 15:30.',
    );
    expect(textAt(payload({ lang: 'pt-BR', offset: 1440 }), 8 * 60).body).toBe(
      'Consulta hoje às 15:30.',
    );
    expect(textAt(payload({ lang: 'pt-BR', offset: 10080 }), 5 * 24 * 60).body).toBe(
      'Consulta marcada para quinta-feira, 22 de outubro, às 15:30.',
    );
  });

  it('names the baby only with show names on', () => {
    expect(textAt(payload({ lang: 'pt-BR', names: { baby: 'Lia' } }), 1440).body).toBe(
      'Lia: consulta amanhã às 15:30.',
    );
    expect(textAt(payload({ names: { baby: 'Lia' } }), 30).body).toMatch(/^Lia: appointment/);
  });

  it('chooses the phrase from the offset and the calendar day in the zone', () => {
    const before = (minutes: number) => START_MS - minutes * MINUTE;
    expect(appointmentPhrase(START_MS, 10080, before(10080), SAO_PAULO)).toBe('week');
    expect(appointmentPhrase(START_MS, 1440, before(1440), SAO_PAULO)).toBe('tomorrow');
    expect(appointmentPhrase(START_MS, 120, before(120), SAO_PAULO)).toBe('hours');
    expect(appointmentPhrase(START_MS, 120, before(100), SAO_PAULO)).toBe('today');
    expect(appointmentPhrase(START_MS, 30, before(30), SAO_PAULO)).toBe('minutes');
    expect(appointmentPhrase(START_MS, 30, before(10), SAO_PAULO)).toBe('today');
    expect(appointmentPhrase(START_MS, 1440, before(3 * 1440), SAO_PAULO)).toBe('on');
  });
});
