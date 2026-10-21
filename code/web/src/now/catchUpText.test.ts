import { beforeEach, describe, expect, it } from 'vitest';
import { activateLocale } from '../i18n/i18n';
import { event, eventType } from '../presets/presetFixtures';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { catchUp } from './catchUp';
import { catchUpLines, catchUpShareText, catchUpSummary, doseText } from './catchUpText';

const MED_TYPE = eventType({ id: 'type-med', key: 'medication', name: 'Medication' });
const TYPES = [FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE, MED_TYPE];
const NOW = new Date(2026, 9, 21, 14, 54);
const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m).toISOString();
const SINCE = at(8, 10);

function other(
  id: string,
  typeId: string,
  start: string,
  end: string | null,
  payload: Record<string, unknown>,
) {
  return event({
    id,
    typeId,
    startedAt: start,
    endedAt: end,
    payload,
    createdBy: 'u-ana',
    createdAt: start,
  });
}

const events = [
  other('a', SLEEP_TYPE.id, at(9), at(10, 15), { kind: 'nap' }),
  other('b', SLEEP_TYPE.id, at(12), at(12, 45), { kind: 'nap' }),
  other('c', FEEDING_TYPE.id, at(9, 40), at(9, 40), { method: 'bottle', amount_ml: 120 }),
  other('d', FEEDING_TYPE.id, at(12, 2), at(12, 2), { method: 'bottle', amount_ml: 120 }),
  other('e', DIAPER_TYPE.id, at(8, 30), at(8, 30), { content: 'WET' }),
  other('f', DIAPER_TYPE.id, at(11), at(11), { content: 'DIRTY' }),
  other('g', 'type-med', at(11, 40), at(11, 40), {
    medications: [{ medicationId: 'm', name: 'Paracetamol', dose: { amount: 2.5, unit: 'ml' } }],
  }),
];
const result = () =>
  catchUp(events, [{ userId: 'u-ana', displayName: 'Ana' }], SINCE, NOW, { types: TYPES })!;

describe('catch-up words', () => {
  beforeEach(async () => {
    await activateLocale('en');
  });

  it('one line per kind of activity with its detail', () => {
    const [group] = result().groups;
    const lines = catchUpLines(group, TYPES).map((l) => [l.text, l.detail]);
    expect(lines[0][0]).toBe('2 sleeps');
    expect(lines[0][1]).toMatch(/ total$/);
    expect(lines.map((l) => l[0])).toEqual([
      '2 sleeps',
      '2 feeds',
      '2 diapers',
      'Paracetamol 2.5 ml',
    ]);
    expect(lines[2][1]).toBe('1 wet, 1 dirty');
    expect(lines[3][1]).toBe('11:40');
    expect(lines[1][1]).toMatch(/^240 mL · last 12:02$/);
    expect(catchUpSummary(group, SINCE)).toBe('Ana logged 7 things since 08:10');
  });

  it('shares as plain text, one line per person', () => {
    const lines = catchUpShareText(result(), 'Lia', TYPES).split('\n');
    expect(lines[0]).toBe('Lia: since 08:10');
    expect(lines[1]).toMatch(
      /^Ana: 2 sleeps \(.* total\), 2 feeds \(240 mL · last 12:02\), 2 diapers/,
    );
    expect(lines[1]).toMatch(/Paracetamol 2\.5 ml \(11:40\)$/);
    expect(lines).toHaveLength(2);
  });

  it('names nobody "Someone" and speaks Portuguese', async () => {
    await activateLocale('pt-BR');
    const noNames = catchUp(events, undefined, SINCE, NOW, { types: TYPES })!;
    expect(catchUpShareText(noNames, 'Lia', TYPES).split('\n')[1]).toMatch(
      /^Alguém: 2 sonos \(.* no total\), 2 mamadas/,
    );
    expect(doseText({ amount: 5, unit: 'drops' })).toBe('5 gotas');
  });

  it('shows a dose unit it does not know as logged', () => {
    expect(doseText({ amount: 1, unit: 'tablets' })).toBe('1 tablets');
  });
});
