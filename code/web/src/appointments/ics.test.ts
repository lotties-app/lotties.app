import { describe, expect, it } from 'vitest';
import type { Appointment } from '../db/models';
import { appointmentToIcs, escapeText, foldLine, icsDateTime, icsFileName } from './ics';

/* The "Add to calendar" file (RFC 5545): golden output, escaping, folding and alarms. */

const BASE: Appointment = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  babyId: 'baby-1',
  title: 'Pediatrician (2 months)',
  type: 'consultation',
  startsAt: '2026-03-04T18:30:00.000Z',
  durationMinutes: 30,
  location: 'Clínica Sorriso, sala 4',
  doctorName: 'Dra. Ana Lima',
  notes: 'Bring the vaccine card; ask about sleep.\nWeigh before.',
  outcome: null,
  status: 'upcoming',
  reminderOffsetsMinutes: [1440, 120],
  createdBy: null,
  createdAt: '2026-02-20T10:00:00.000Z',
  updatedAt: '2026-02-21T11:15:30.000Z',
};

const OPTIONS = { now: new Date('2026-03-01T12:00:00.000Z'), labels: { doctor: 'Doctor' } };

describe('appointmentToIcs', () => {
  it('writes the golden VCALENDAR with CRLF line endings', () => {
    expect(appointmentToIcs(BASE, OPTIONS)).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Lotties//Appointments//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:3f2504e0-4f89-41d3-9a0c-0305e82c3301@lotties.app',
        'DTSTAMP:20260301T120000Z',
        'DTSTART:20260304T183000Z',
        'DTEND:20260304T190000Z',
        'SUMMARY:Pediatrician (2 months)',
        'LOCATION:Clínica Sorriso\\, sala 4',
        'DESCRIPTION:Doctor: Dra. Ana Lima\\nBring the vaccine card\\; ask about sleep',
        ' .\\nWeigh before.',
        'STATUS:CONFIRMED',
        'LAST-MODIFIED:20260221T111530Z',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Pediatrician (2 months)',
        'TRIGGER:-PT1440M',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Pediatrician (2 months)',
        'TRIGGER:-PT120M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('ends one hour after the start without a duration, and omits empty parts', () => {
    const text = appointmentToIcs(
      {
        ...BASE,
        durationMinutes: null,
        location: null,
        doctorName: null,
        notes: null,
        reminderOffsetsMinutes: [],
      },
      OPTIONS,
    );

    expect(text).toContain('DTEND:20260304T193000Z\r\n');
    expect(text).not.toMatch(/LOCATION|DESCRIPTION|VALARM/);
    expect(text.split('\r\n').every((line) => !line.includes('\n'))).toBe(true);
  });

  it('marks a cancelled appointment as cancelled and adds one alarm per offset', () => {
    const text = appointmentToIcs(
      { ...BASE, status: 'cancelled', reminderOffsetsMinutes: [10080, 1440, 120, 30] },
      OPTIONS,
    );

    expect(text).toContain('STATUS:CANCELLED\r\n');
    expect(text.match(/TRIGGER:-PT\d+M/g)).toEqual([
      'TRIGGER:-PT10080M',
      'TRIGGER:-PT1440M',
      'TRIGGER:-PT120M',
      'TRIGGER:-PT30M',
    ]);
  });
});

describe('ics helpers', () => {
  it('escapes backslashes, semicolons, commas and every kind of line break', () => {
    expect(escapeText('a\\b;c,d\r\ne\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
  });

  it('folds at 75 octets, never inside a multi-byte character', () => {
    const line = `SUMMARY:${'á'.repeat(80)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    const encoder = new TextEncoder();

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(parts.every((part) => encoder.encode(part).length <= 75)).toBe(true);
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(line);
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
  });

  it('writes UTC basic date-times and a dated file name', () => {
    expect(icsDateTime('2026-11-01T05:30:00.000Z')).toBe('20261101T053000Z');
    expect(icsFileName(BASE, 'America/Sao_Paulo')).toBe('lotties-appointment-2026-03-04.ics');
    expect(icsFileName({ startsAt: '2026-03-05T01:00:00.000Z' }, 'America/New_York')).toBe(
      'lotties-appointment-2026-03-04.ics',
    );
  });
});
