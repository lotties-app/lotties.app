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
    expect(category('bath')).toBe('care');
    expect(category('tummy_time')).toBe('activity');
    expect(category('something_new')).toBe('custom');
  });

  it('a type the user created is always custom, whatever its key', () => {
    expect(typeCategory({ key: 'sleep', babyId: 'baby-1' })).toBe('custom');
    expect(typeCategory(undefined)).toBe('custom');
  });

  it('takes the Tabler icon of the stored icon name, with a fallback', () => {
    expect(typeIcon({ icon: 'local_drink' })).toBe('bottle');
    expect(typeIcon({ icon: 'constructor' })).toBe('event');
    expect(typeIcon(undefined)).toBe('event');
  });
});
