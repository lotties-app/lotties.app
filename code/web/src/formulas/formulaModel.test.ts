import { describe, expect, it } from 'vitest';
import type { BabyEvent, Formula } from '../db/models';
import { FEEDING_TYPE } from '../test/builtInTypes';
import {
  activeFormulas,
  bottleFormulaName,
  currentFormula,
  declaresFormula,
  defaultFormula,
  formulaMembers,
  lastUsedFormula,
  shouldBecomeCurrent,
} from './formulaModel';
import { FORMULA_SUGGESTIONS, suggestFormulaNames } from './formulaSuggestions';

const formula = (id: string, extra: Partial<Formula> = {}): Formula => ({
  id,
  babyId: 'b1',
  name: id.toUpperCase(),
  brand: null,
  stage: null,
  notes: null,
  startedOn: null,
  isCurrent: false,
  archived: false,
  createdBy: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...extra,
});

const bottle = (at: string, formulaId: string, extra: Partial<BabyEvent> = {}): BabyEvent => ({
  id: `e-${at}`,
  babyId: 'b1',
  typeId: FEEDING_TYPE.id,
  startedAt: at,
  endedAt: at,
  payload: { method: 'bottle', bottle_feeding_type: 'formula', formula_id: formulaId },
  notes: null,
  createdBy: null,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  ...extra,
});

describe('current formula', () => {
  it('is the one marked current and not archived; the newest edit wins a lagging pull', () => {
    const older = formula('a', { isCurrent: true, clientUpdatedAt: '2026-10-02T10:00:00.000Z' });
    const newer = formula('b', { isCurrent: true, clientUpdatedAt: '2026-10-03T10:00:00.000Z' });
    const archived = formula('c', { isCurrent: true, archived: true });

    expect(currentFormula([older, newer, archived])?.id).toBe('b');
    expect(currentFormula([archived])).toBeNull();
    expect(shouldBecomeCurrent([archived])).toBe(true);
    expect(shouldBecomeCurrent([older])).toBe(false);
  });

  it('lists the active formulas by name', () => {
    expect(
      activeFormulas([
        formula('z', { name: 'Nan 2' }),
        formula('y', { name: 'Aptamil 1' }),
        formula('x', { archived: true }),
      ]).map((f) => f.name),
    ).toEqual(['Aptamil 1', 'Nan 2']);
  });
});

describe('default formula of a new bottle', () => {
  const nan = formula('nan', { name: 'Nan 1' });
  const apt = formula('apt', { name: 'Aptamil 2' });

  it('prefers the current formula', () => {
    const events = [bottle('2026-10-05T08:00:00.000Z', 'nan')];
    expect(defaultFormula([nan, { ...apt, isCurrent: true }], events)?.id).toBe('apt');
  });

  it('falls back to the last one used, skipping archived and deleted ones', () => {
    const events = [
      bottle('2026-10-05T08:00:00.000Z', 'nan'),
      bottle('2026-10-06T08:00:00.000Z', 'apt'),
      bottle('2026-10-07T08:00:00.000Z', 'nan', { deletedAt: '2026-10-07T09:00:00.000Z' }),
    ];
    expect(lastUsedFormula([nan, apt], events, FEEDING_TYPE.id)?.id).toBe('apt');
    expect(lastUsedFormula([nan, { ...apt, archived: true }], events)?.id).toBe('nan');
    expect(defaultFormula([nan, apt], [])).toBeNull();
  });
});

describe('bottle payload members', () => {
  it('carry the id and a name snapshot that outlives a rename', () => {
    const payload = { method: 'bottle', ...formulaMembers({ id: 'nan', name: 'Nan 1' }) };
    expect(payload).toMatchObject({ formula_id: 'nan', formula_name: 'Nan 1' });
    expect(bottleFormulaName(payload, [formula('nan', { name: 'Nan Supreme 1' })])).toBe('Nan 1');
    expect(bottleFormulaName({ formula_id: 'nan' }, [formula('nan', { name: 'Nan 1' })])).toBe(
      'Nan 1',
    );
    expect(declaresFormula(FEEDING_TYPE)).toBe(true);
  });
});

describe('name suggestions', () => {
  it('suggest names whose words start with what was typed, ignoring case and accents', () => {
    expect(suggestFormulaNames('apt')).toEqual([
      'Aptamil 1',
      'Aptamil 2',
      'Aptamil 3',
      'Aptamil Pepti',
      'Aptamil Profutura 1',
      'Aptamil Profutura 2',
    ]);
    expect(suggestFormulaNames('SUPREME')).toEqual(['Nan Supreme 1', 'Nan Supreme 2']);
    expect(suggestFormulaNames('nestógeno 2')).toEqual([]);
    expect(suggestFormulaNames('nestogeno')).toEqual(['Nestogeno 1', 'Nestogeno 2']);
  });

  it('suggest nothing before typing, never the exact name or a name the baby has', () => {
    expect(suggestFormulaNames('  ')).toEqual([]);
    expect(suggestFormulaNames('Nan 1')).not.toContain('Nan 1');
    expect(suggestFormulaNames('nan', ['Nan 2'])).toEqual([
      'Nan 1',
      'Nan 3',
      'Nan Supreme 1',
      'Nan Supreme 2',
    ]);
  });

  it('is a small neutral list of names only', () => {
    expect(FORMULA_SUGGESTIONS.length).toBeLessThanOrEqual(25);
    for (const name of FORMULA_SUGGESTIONS) expect(name).toMatch(/^[A-Za-z][A-Za-z0-9 +]*$/);
  });
});
