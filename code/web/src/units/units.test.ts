import { describe, expect, it } from 'vitest';
import vectors from './unitsVectors.json';
import {
  cToF,
  cmToIn,
  fToC,
  flOzToMl,
  inToCm,
  kgToLbOz,
  lbOzToKg,
  mlToFlOz,
  roundDisplay,
} from './convert';
import { formatLength, formatTemperature, formatVolume, formatWeight } from './format';
import {
  parseLength,
  parseTemperature,
  parseVolume,
  parseWeightKg,
  parseWeightLbOz,
} from './parse';
import { resolveUnitSystem, type UnitSetting } from './system';

describe('shared vectors', () => {
  it.each(vectors.resolve)('resolves $setting + "$locale" to $expect', (c) => {
    expect(resolveUnitSystem(c.setting as UnitSetting, c.locale)).toBe(c.expect);
  });

  it.each(vectors.volumeMlToOz)('$ml ml shows $text fl oz', (c) => {
    expect(String(roundDisplay(mlToFlOz(c.ml), 1))).toBe(c.text);
  });
  it.each(vectors.volumeOzToMl)('$oz fl oz types $ml ml', (c) => {
    expect(flOzToMl(c.oz)).toBe(c.ml);
  });
  it.each(vectors.weightKgToLbOz)('$kg kg is $text', (c) => {
    expect(kgToLbOz(c.kg)).toEqual({ lb: c.lb, oz: c.oz });
    expect(formatWeight(c.kg, 'us', 'en')).toBe(c.text);
  });
  it.each(vectors.weightLbOzToKg)('$lb lb $oz oz types $kg kg', (c) => {
    expect(lbOzToKg(c.lb, c.oz)).toBe(c.kg);
  });
  it.each(vectors.lengthCmToIn)('$cm cm shows $text in', (c) => {
    expect(String(roundDisplay(cmToIn(c.cm), 1))).toBe(c.text);
  });
  it.each(vectors.lengthInToCm)('$in in types $cm cm', (c) => {
    expect(inToCm(c.in)).toBe(c.cm);
  });
  it.each(vectors.temperatureCToF)('$c C shows $text F', (c) => {
    expect(String(roundDisplay(cToF(c.c), 1))).toBe(c.text);
  });
  it.each(vectors.temperatureFToC)('$f F types $c C', (c) => {
    expect(fToC(c.f)).toBe(c.c);
  });
});

describe('formatting', () => {
  it('formats volume in both systems and languages', () => {
    expect(formatVolume(120, 'metric', 'pt-BR')).toBe('120 ml');
    expect(formatVolume(120, 'us', 'en')).toBe('4.1 fl oz');
    expect(formatVolume(120, 'us', 'pt-BR')).toBe('4,1 fl oz');
  });
  it('formats weight, length and temperature', () => {
    expect(formatWeight(3.5, 'metric', 'en')).toBe('3.5 kg');
    expect(formatWeight(3.5, 'us', 'pt-BR')).toBe('7 lb 11 oz');
    expect(formatWeight(0.3, 'us', 'en')).toBe('11 oz');
    expect(formatLength(50, 'us', 'en')).toBe('19.7 in');
    expect(formatLength(50, 'us', 'pt-BR')).toBe('19,7 pol.');
    expect(formatLength(50, 'metric', 'pt-BR')).toBe('50 cm');
    expect(formatTemperature(37, 'us', 'en')).toBe('98.6 °F');
    expect(formatTemperature(37.5, 'metric', 'pt-BR')).toBe('37,5 °C');
  });
});

describe('parsing', () => {
  it('stores whole ml for US ounces, comma or dot', () => {
    expect(parseVolume('4', 'us')).toBe(118);
    expect(parseVolume('4,5', 'us')).toBe(133);
    expect(parseVolume('4.5', 'us')).toBe(133);
    expect(parseVolume('120', 'metric')).toBe(120);
    expect(parseVolume('abc', 'us')).toBeNull();
  });
  it('stores whole grams for pounds and ounces', () => {
    expect(parseWeightLbOz('7', '11')).toBe(3.487);
    expect(parseWeightLbOz('', '11')).toBe(0.312);
    expect(parseWeightLbOz('7', '')).toBe(3.175);
    expect(parseWeightLbOz('', '')).toBeNull();
    expect(parseWeightLbOz('7', 'x')).toBeNull();
    expect(parseWeightKg('3,5')).toBe(3.5);
  });
  it('converts length and temperature back', () => {
    expect(parseLength('19,7', 'us')).toBe(50);
    expect(parseTemperature('98.6', 'us')).toBe(37);
    expect(parseTemperature('37,5', 'metric')).toBe(37.5);
  });
});
