import { afterEach, describe, expect, it } from 'vitest';
import { doseText as catchUpDoseText } from '../now/catchUpText';
import { useTestLocale } from '../test/locale';
import {
  FORM_ICONS,
  PRODUCT_FORMS,
  countedAmountText,
  countedUnitForForm,
  countedUnitOf,
  amountStepOf,
  fitsAmountStep,
} from './doseUnits';
import { ICON_COMPONENTS } from '../ui/icons';
import { amountWithUnit, doseText, unitText } from './prescriptionForm';

afterEach(async () => {
  await useTestLocale('en');
});

describe('counted dose units (mirror of the API DoseUnits)', () => {
  it('recognises English and Portuguese aliases in any case', () => {
    expect(countedUnitOf(' Sprays ')).toBe('spray');
    expect(countedUnitOf('jatos')).toBe('spray');
    expect(countedUnitOf('puff')).toBe('puff');
    expect(countedUnitOf('INALAÇÃO')).toBe('puff');
    expect(countedUnitOf('supositório')).toBe('suppository');
    expect(countedUnitOf('aplicações')).toBe('application');
  });

  it('leaves measured and unknown units alone', () => {
    for (const unit of ['drops', 'gotas', 'ml', 'mg', 'tablet', '', 'constructor', '__proto__']) {
      expect(countedUnitOf(unit), unit).toBeNull();
    }
  });

  it('keeps sprays and puffs whole and allows half suppositories', () => {
    expect(
      ['spray', 'puff', 'suppository', 'application'].map((u) => amountStepOf(u as never)),
    ).toEqual([1, 1, 0.5, null]);
    expect(fitsAmountStep(1.5, 'suppository')).toBe(true);
    expect(fitsAmountStep(0.5, 'suppository')).toBe(true);
    expect(fitsAmountStep(1.25, 'suppository')).toBe(false);
    expect(fitsAmountStep(1.5, 'spray')).toBe(false);
    expect(fitsAmountStep(0.3, 'application')).toBe(true);
  });

  it('maps the counted forms to their unit and the others to none', () => {
    expect(countedUnitForForm('spray')).toBe('spray');
    expect(countedUnitForForm('inhaler')).toBe('puff');
    expect(countedUnitForForm('suppository')).toBe('suppository');
    expect(countedUnitForForm('ointment')).toBe('application');
    for (const form of ['drops', 'syrup', 'tablet', 'powder', 'other'] as const) {
      expect(countedUnitForForm(form)).toBeNull();
    }
    expect(countedUnitForForm(null)).toBeNull();
  });

  it('gives every form a registered icon', () => {
    for (const form of PRODUCT_FORMS) {
      expect(Object.hasOwn(ICON_COMPONENTS, FORM_ICONS[form]), form).toBe(true);
    }
  });
});

describe('counted dose text', () => {
  it('pluralises in English', () => {
    expect(countedAmountText(1, 'spray')).toBe('1 spray');
    expect(countedAmountText(2, 'spray')).toBe('2 sprays');
    expect(amountWithUnit(2, 'puffs')).toBe('2 puffs');
    expect(amountWithUnit(1, 'suppositories')).toBe('1 suppository');
    expect(amountWithUnit(1, 'aplicação')).toBe('1 application');
    expect(unitText('jatos')).toBe('sprays');
    expect(doseText({ amount: 2, unit: 'sprays', perKg: false })).toBe('2 sprays');
    expect(catchUpDoseText({ amount: 1, unit: 'sprays' })).toBe('1 spray');
  });

  it('pluralises in Portuguese', async () => {
    await useTestLocale('pt-BR');
    expect(amountWithUnit(1, 'sprays')).toBe('1 jato');
    expect(amountWithUnit(2, 'jatos')).toBe('2 jatos');
    expect(amountWithUnit(2, 'puffs')).toBe('2 jatos');
    expect(amountWithUnit(1, 'suppository')).toBe('1 supositório');
    expect(amountWithUnit(2, 'supositórios')).toBe('2 supositórios');
    expect(amountWithUnit(2, 'applications')).toBe('2 aplicações');
    expect(unitText('applications')).toBe('aplicações');
    expect(catchUpDoseText({ amount: 3, unit: 'sprays' })).toBe('3 jatos');
  });

  it('keeps the existing units as before', () => {
    expect(amountWithUnit(1, 'drops')).toBe('1 drop');
    expect(amountWithUnit(2.5, 'ml')).toBe('2.5 ml');
    expect(amountWithUnit(1, 'tablets')).toBe('1 tablets');
  });
});
