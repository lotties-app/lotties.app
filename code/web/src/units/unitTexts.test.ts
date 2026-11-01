import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventType } from '../db/models';
import { activateLocale } from '../i18n/i18n';
import { formatMetricUnit, formatUnit } from '../i18n/format';
import { FEEDING_TYPE, TEMPERATURE_TYPE } from '../test/builtInTypes';
import { amountOfText, payloadSummary } from '../timeline/payloadSummary';
import { fieldQuantity, fieldValueText } from './display';
import { setDeviceLocaleTag, setUnitSetting } from './state';
import { snapVolume, volumePresets } from './presets';

/*
 * The text builders that are not components read the unit system from module state: the same
 * stored payload reads in metric or US customary, and only ml and degrees C fields convert.
 */

const customType = (unit: string | null): EventType => ({
  ...FEEDING_TYPE,
  id: 'custom',
  key: 'custom',
  babyId: 'baby-1',
  fields: [
    {
      ...FEEDING_TYPE.fields[0]!,
      key: 'amount',
      kind: 'number',
      unit,
      options: [],
      min: null,
      max: null,
    },
  ],
});

beforeEach(() => setDeviceLocaleTag('en-GB'));

afterEach(async () => {
  setUnitSetting('auto');
  await activateLocale('en');
});

describe("payload text in the person's units", () => {
  it('metric keeps every wording as before', () => {
    expect(payloadSummary({ method: 'bottle', amount_ml: 120 }, FEEDING_TYPE)).toBe(
      'Bottle · 120 ml',
    );
    expect(payloadSummary({ value_c: 37.8 }, TEMPERATURE_TYPE)).toContain('37.8 °C');
    expect(amountOfText(80, 120)).toBe('80 of 120 ml');
  });

  it('US customary shows fluid ounces and degrees F, the stored payload untouched', () => {
    setUnitSetting('us');
    const payload = { method: 'bottle', amount_ml: 120 };
    expect(payloadSummary(payload, FEEDING_TYPE)).toBe('Bottle · 4.1 fl oz');
    expect(payload).toEqual({ method: 'bottle', amount_ml: 120 });
    expect(payloadSummary({ value_c: 37 }, TEMPERATURE_TYPE)).toContain('98.6 °F');
    expect(amountOfText(80, 120)).toBe('2.7 of 4.1 fl oz');
  });

  it('a custom field in ml or C converts, any other unit is left alone', () => {
    setUnitSetting('us');
    expect(payloadSummary({ amount: 60 }, customType('ml'))).toBe('2 fl oz');
    expect(payloadSummary({ amount: 38 }, customType('C'))).toBe('100.4 °F');
    expect(payloadSummary({ amount: 38 }, customType('°C'))).toBe('100.4 °F');
    expect(payloadSummary({ amount: 60 }, customType('g'))).toBe('60 g');
    expect(payloadSummary({ amount: 60 }, customType('mg'))).toBe('60 mg');
    expect(fieldQuantity('ml')).toBe('volume');
    expect(fieldQuantity('kg')).toBeNull();
    expect(fieldValueText('drops', 3)).toBeNull();
  });

  it('speaks Portuguese: decimal comma and pol.', async () => {
    await activateLocale('pt-BR');
    setUnitSetting('us');
    expect(amountOfText(80, 120)).toBe('2,7 de 4,1 fl oz');
    expect(formatUnit(50, 'centimeter', 'pt-BR')).toBe('19,7 pol.');
  });
});

describe('formatUnit', () => {
  it('converts ml, kg and cm in US and keeps doses metric through formatMetricUnit', () => {
    setUnitSetting('us');
    expect(formatUnit(120, 'milliliter', 'en')).toBe('4.1 fl oz');
    expect(formatUnit(3.5, 'kilogram', 'en')).toBe('7 lb 11 oz');
    expect(formatUnit(50, 'centimeter', 'en')).toBe('19.7 in');
    expect(formatMetricUnit(3.5, 'kilogram', 'en')).toBe('3.5 kg');
  });
});

describe('volume presets', () => {
  it('snap to half fluid ounces stored as whole ml, each once', () => {
    expect(snapVolume(120, 'us')).toBe(118);
    expect(snapVolume(120, 'metric')).toBe(120);
    expect(volumePresets([110, 120, 130, 150], 'us')).toEqual([104, 118, 133, 148]);
    expect(volumePresets([90, 120], 'metric')).toEqual([90, 120]);
  });
});
