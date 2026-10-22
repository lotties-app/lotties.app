import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test/renderUi';
import {
  BELLY_MASSAGE_TYPE,
  BREAST_PUMP_TYPE,
  DIAPER_TYPE,
  FEEDING_TYPE,
  FUSSY_TYPE,
  MORE_BUILT_IN_TYPES,
  NASAL_SUCTION_TYPE,
  SLEEP_TYPE,
  TEMPERATURE_TYPE,
} from '../../test/builtInTypes';
import { EventIllustration } from './EventIllustration';
import { illustrationKeyFor } from './eventKey';
import { ILLUSTRATION_NAMES, illustrationName } from './registry';

describe('illustrationKeyFor', () => {
  it('picks the drawing of a sleep kind and defaults to the nap', () => {
    expect(illustrationKeyFor(SLEEP_TYPE, { kind: 'night' })).toBe('night');
    expect(illustrationKeyFor(SLEEP_TYPE, { kind: 'night_waking' })).toBe('night_waking');
    expect(illustrationKeyFor(SLEEP_TYPE, { kind: 'bed_time' })).toBe('bed_time');
    expect(illustrationKeyFor(SLEEP_TYPE, { kind: 'woke_up' })).toBe('woke_up');
    expect(illustrationKeyFor(SLEEP_TYPE, {})).toBe('nap');
  });

  it('picks the drawing of a feeding method and defaults to the bottle', () => {
    expect(illustrationKeyFor(FEEDING_TYPE, { method: 'breast' })).toBe('breast');
    expect(illustrationKeyFor(FEEDING_TYPE, { method: 'solid' })).toBe('solid');
    expect(illustrationKeyFor(FEEDING_TYPE, {})).toBe('bottle');
  });

  it('uses the type key for the other built-in types', () => {
    expect(illustrationKeyFor(DIAPER_TYPE)).toBe('diaper');
    expect(illustrationKeyFor(BREAST_PUMP_TYPE)).toBe('breast_pump');
  });

  it('has a drawing for every key it returns for the built-in types', () => {
    const keys = [
      ...['nap', 'night', 'night_waking', 'bed_time', 'woke_up', 'fell_asleep'].map((kind) =>
        illustrationKeyFor(SLEEP_TYPE, { kind }),
      ),
      ...['breast', 'bottle', 'solid'].map((method) =>
        illustrationKeyFor(FEEDING_TYPE, { method }),
      ),
      illustrationKeyFor(DIAPER_TYPE),
      illustrationKeyFor(BREAST_PUMP_TYPE),
    ];
    for (const key of keys) {
      const name = illustrationName(key);
      expect(name, key).toBeDefined();
      expect(ILLUSTRATION_NAMES).toContain(name);
    }
  });

  it('gives a custom type, a missing type and an inherited key no drawing of their own', () => {
    expect(illustrationKeyFor({ key: 'sleep', babyId: 'baby-1' }, { kind: 'night' })).toBe('');
    expect(illustrationKeyFor(undefined)).toBe('');
    expect(
      illustrationName(illustrationKeyFor({ key: 'constructor', babyId: null })),
    ).toBeUndefined();
  });

  it('reads the payload by own properties only', () => {
    const payload = JSON.parse('{"__proto__": {"kind": "night"}}') as Record<string, unknown>;
    expect(illustrationKeyFor(SLEEP_TYPE, payload)).toBe('nap');
  });
});

describe('EventIllustration', () => {
  it('renders the drawing of the event', () => {
    const { container } = renderUi(
      <EventIllustration type={FEEDING_TYPE} payload={{ method: 'breast' }} size={64} />,
    );
    expect(container.querySelector('svg[data-illustration="nursing"]')).toBeTruthy();
  });

  it('renders the wind icon tile for nasal suction, which has no drawing of its own', () => {
    expect(illustrationKeyFor(NASAL_SUCTION_TYPE, { tool: 'bulb' })).toBe('nasal_suction');
    expect(illustrationName('nasal_suction')).toBeUndefined();
    const { container } = renderUi(<EventIllustration type={NASAL_SUCTION_TYPE} size={64} />);
    expect(container.querySelector('svg[data-illustration]')).toBeNull();
    expect(container.querySelector('svg[data-icon="wind"]')).toBeTruthy();
  });

  it('renders the massage icon tile for belly massage, which has no drawing of its own', () => {
    expect(illustrationKeyFor(BELLY_MASSAGE_TYPE, { reason: 'gas' })).toBe('belly_massage');
    expect(illustrationName('belly_massage')).toBeUndefined();
    const { container } = renderUi(<EventIllustration type={BELLY_MASSAGE_TYPE} size={64} />);
    expect(container.querySelector('svg[data-illustration]')).toBeNull();
    expect(container.querySelector('svg[data-icon="massage"]')).toBeTruthy();
  });

  it('renders the crying-face icon tile for a fussy spell, which has no drawing of its own', () => {
    expect(illustrationKeyFor(FUSSY_TYPE, { intensity: 'mild' })).toBe('fussy');
    expect(illustrationName('fussy')).toBeUndefined();
    const { container } = renderUi(<EventIllustration type={FUSSY_TYPE} size={64} />);
    expect(container.querySelector('svg[data-illustration]')).toBeNull();
    expect(container.querySelector('svg[data-icon="mood-cry"]')).toBeTruthy();
  });

  it('renders the thermometer drawing for a temperature reading', () => {
    expect(illustrationKeyFor(TEMPERATURE_TYPE, { value_c: 37.8 })).toBe('temperature');
    const { container } = renderUi(<EventIllustration type={TEMPERATURE_TYPE} size={64} />);
    expect(container.querySelector('svg[data-illustration="temperature"]')).toBeTruthy();
  });

  it.each([
    ['nail_trim', 'scissors'],
    ['spit_up', 'mood-sick'],
    ['teething', 'tooth'],
    ['milestone', 'trophy'],
    ['symptom', 'virus'],
    ['outdoor', 'trees'],
    ['skin_care', 'lotion'],
  ])('renders the %s type icon tile (%s), which has no drawing of its own', (key, icon) => {
    const type = MORE_BUILT_IN_TYPES.find((t) => t.key === key)!;
    expect(illustrationKeyFor(type)).toBe(key);
    expect(illustrationName(key)).toBeUndefined();
    const { container } = renderUi(<EventIllustration type={type} size={64} />);
    expect(container.querySelector('svg[data-illustration]')).toBeNull();
    expect(container.querySelector(`svg[data-icon="${icon}"]`)).toBeTruthy();
  });

  it('renders the icon tile of a custom type instead of a drawing', () => {
    const { container } = renderUi(
      <EventIllustration type={{ ...FEEDING_TYPE, babyId: 'baby-1' }} size={64} />,
    );
    expect(container.querySelector('svg[data-illustration]')).toBeNull();
    expect(container.querySelector('[data-icon]')).toBeTruthy();
  });
});
