import { describe, expect, it } from 'vitest';
import { typeCategory, typeIcon } from './typeVisual';

describe('typeVisual', () => {
  it('maps the built-in type keys to the design categories', () => {
    const category = (key: string) => typeCategory({ key, babyId: null });
    expect(category('sleep')).toBe('sleep');
    expect(category('feeding')).toBe('feeding');
    expect(category('breast_pump')).toBe('feeding');
    expect(category('diaper')).toBe('diaper');
    expect(category('medication')).toBe('health');
    expect(category('belly_pain')).toBe('health');
    expect(category('nasal_suction')).toBe('health');
    expect(category('belly_massage')).toBe('health');
    expect(category('fussy')).toBe('care');
    expect(category('bath')).toBe('care');
    expect(category('tummy_time')).toBe('activity');
    for (const key of ['temperature', 'spit_up', 'teething', 'symptom']) {
      expect(category(key), key).toBe('health');
    }
    for (const key of ['nail_trim', 'milestone', 'outdoor', 'skin_care']) {
      expect(category(key), key).toBe('care');
    }
    expect(category('something_new')).toBe('custom');
  });

  it('a type the user created is always custom, whatever its key', () => {
    expect(typeCategory({ key: 'sleep', babyId: 'baby-1' })).toBe('custom');
    expect(typeCategory(undefined)).toBe('custom');
  });

  it('takes the Tabler icon of the stored icon name, with a fallback', () => {
    expect(typeIcon({ icon: 'local_drink' })).toBe('bottle');
    expect(typeIcon({ icon: 'air' })).toBe('wind');
    expect(typeIcon({ icon: 'massage' })).toBe('massage');
    expect(typeIcon({ icon: 'sentiment_very_dissatisfied' })).toBe('mood-cry');
    expect(typeIcon({ icon: 'content_cut' })).toBe('scissors');
    expect(typeIcon({ icon: 'thermostat' })).toBe('thermometer');
    expect(typeIcon({ icon: 'sentiment_sick' })).toBe('mood-sick');
    expect(typeIcon({ icon: 'dentistry' })).toBe('tooth');
    expect(typeIcon({ icon: 'emoji_events' })).toBe('trophy');
    expect(typeIcon({ icon: 'coronavirus' })).toBe('virus');
    expect(typeIcon({ icon: 'park' })).toBe('trees');
    expect(typeIcon({ icon: 'sanitizer' })).toBe('lotion');
    expect(typeIcon({ icon: 'constructor' })).toBe('event');
    expect(typeIcon(undefined)).toBe('event');
  });
});
