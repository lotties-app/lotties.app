import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/push.en.json';
import ptBR from '../../i18n/locales/push.pt-BR.json';
import { formatTime, interpolate, renderText } from './notificationText';
import { parsePayload } from './payload';
import { dosePayload, napPayload, testPayload } from './pushTestKit';

const UTC = 'UTC';
const text = (value: Record<string, unknown>) =>
  renderText(parsePayload(JSON.stringify(value), 'en'), UTC);

describe('push notification text', () => {
  it('interpolates own values only and refuses half-rendered text', () => {
    expect(interpolate('At {{time}}.', { time: '18:00' })).toBe('At 18:00.');
    expect(interpolate('At {{ time }}.', { time: '18:00' })).toBe('At 18:00.');
    expect(interpolate('At {{time}}.', {})).toBeUndefined();
    expect(interpolate('{{constructor}}', {})).toBeUndefined();
  });

  it('formats times as hours and minutes', () => {
    expect(formatTime(Date.UTC(2026, 9, 21, 21, 5), 'en', UTC)).toMatch(/09:05\s?PM/);
    expect(formatTime(Date.UTC(2026, 9, 21, 21, 5), 'pt-BR', UTC)).toBe('21:05');
  });

  it('shows generic dose text without names, in both languages', () => {
    expect(text(dosePayload())).toEqual({
      title: 'Medicine reminder',
      body: expect.stringMatching(/^A scheduled dose for 09:00\sPM is not logged yet\.$/),
    });
    expect(text(dosePayload({ lang: 'pt-BR' }))).toEqual({
      title: 'Lembrete de remédio',
      body: 'Uma dose agendada para 21:00 ainda não foi registrada.',
    });
  });

  it('shows names only when the payload carries them (show names on)', () => {
    expect(
      text(dosePayload({ lang: 'pt-BR', names: { baby: 'Lia', medication: 'Xarope' } })).body,
    ).toBe('Lia: Xarope agendado para 21:00, ainda não registrado.');
    expect(text(napPayload({ lang: 'pt-BR', names: { baby: 'Lia' } })).body).toBe(
      'Lia: a janela estimada de soneca abre por volta de 17:20.',
    );
  });

  it('keeps dose text generic when the medication name is missing', () => {
    expect(text(dosePayload({ lang: 'pt-BR', names: { baby: 'Lia' } })).body).toBe(
      'Uma dose agendada para 21:00 ainda não foi registrada.',
    );
  });

  it('never shows a dose amount or a raw code', () => {
    const all = [dosePayload(), napPayload(), testPayload(), { v: 1, kind: 'weird' }].map(text);
    for (const { title, body } of all) {
      expect(`${title} ${body}`).not.toMatch(/dose_due|nap_window|weird|\bml\b|\bmg\b|\{\{/);
    }
  });

  it('renders nap and test text', () => {
    expect(text(napPayload())).toMatchObject({ title: 'Nap window' });
    expect(text(testPayload({ lang: 'pt-BR' }))).toEqual({
      title: 'Notificações ativadas',
      body: 'Este é um teste do Lotties.',
    });
  });

  it('falls back to generic text for invalid payloads, in their language', () => {
    expect(text({ v: 2, lang: 'pt-BR' })).toEqual({
      title: ptBR.generic.title,
      body: ptBR.generic.body,
    });
    expect(text({ kind: 'dose_due' })).toEqual({ title: en.generic.title, body: en.generic.body });
  });
});
