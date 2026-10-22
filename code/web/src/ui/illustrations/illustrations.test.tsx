import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../presets/catalogue';
import { FEEDING_DTO, SLEEP_DTO } from '../../test/builtInTypes';
import { renderUi } from '../../test/renderUi';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { SCHEMES, SCHEME_NAMES } from '../../theme/tokens';
import { blue, contrast } from './color';
import {
  FallbackIllustration,
  ILLUSTRATIONS,
  ILLUSTRATION_NAMES,
  Illustration,
  illustrationFor,
  illustrationName,
} from './index';

const HEX = /#[0-9a-f]{6}/gi;

/** Every colour written in a fill, stroke or stop of the rendered SVG. */
function paints(root: Element): string[] {
  const values: string[] = [];
  for (const el of root.querySelectorAll('*')) {
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const value = el.getAttribute(attr);
      if (value) values.push(value);
    }
  }
  return values;
}

describe.each(ILLUSTRATION_NAMES)('%s illustration', (name) => {
  const Component = ILLUSTRATIONS[name].component;

  it('is decorative by default, 48 px on the 96 grid', () => {
    const { container } = render(<Component scheme="dark" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBeNull();
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
    expect(svg.getAttribute('viewBox')).toBe('0 0 96 96');
    expect(svg.getAttribute('data-illustration')).toBe(name);
  });

  it('is a named image when titled', () => {
    render(<Component title="Bottle feed" size={64} scheme="light" />);
    const image = screen.getByRole('img', { name: 'Bottle feed' });
    expect(image.getAttribute('aria-hidden')).toBeNull();
    expect(image.getAttribute('width')).toBe('64');
  });

  it('uses the compact optical size at 32 px and under, without the ground glow', () => {
    const { container } = render(
      <>
        <Component size={24} scheme="dark" />
        <Component size={96} scheme="dark" />
      </>,
    );
    const [small, large] = container.querySelectorAll('svg');
    expect(small.getAttribute('width')).toBe('24');
    expect(small.getAttribute('viewBox')).toBe('5 5 86 86');
    expect(small.querySelector('ellipse')).toBeNull();
    expect(large.getAttribute('width')).toBe('96');
    expect(large.querySelector('ellipse')).not.toBeNull();
  });

  it('never repeats an id when rendered twice, and every reference resolves', () => {
    const { container } = render(
      <>
        <Component scheme="light" glow />
        <Component scheme="light" glow />
        <Component scheme="dark" />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const value of paints(container)) {
      const ref = /^url\(#(.+)\)$/.exec(value)?.[1];
      if (ref) expect(ids, value).toContain(ref);
    }
  });

  it('paints with gradients and an optional halo in light and dark', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { container, unmount } = render(<Component scheme={scheme} glow />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('data-scheme')).toBe(scheme);
      expect(svg.querySelectorAll('linearGradient').length).toBeGreaterThan(0);
      expect(svg.querySelector('circle[r="48"]')).not.toBeNull();
      unmount();
    }
  });

  it('is flat and warm in the night scheme: no gradient, halo or ground, blue at most 0x78', () => {
    const { container } = render(<Component scheme="night" glow size={96} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('data-scheme')).toBe('night');
    expect(svg.querySelector('defs')).toBeNull();
    expect(svg.querySelector('circle[r="48"]')).toBeNull();
    expect(svg.querySelector('ellipse')).toBeNull();
    const colours = paints(svg).filter((value) => value !== 'none');
    expect(colours.length).toBeGreaterThan(0);
    for (const value of colours) {
      expect(value, 'no gradient in night').toMatch(HEX);
      expect(blue(value), value).toBeLessThanOrEqual(0x78);
    }
  });

  it.each(SCHEME_NAMES)(
    'keeps its main shape at 3:1 on its tile, the surface and the background (%s)',
    (scheme) => {
      const { container } = render(<Component scheme={scheme} />);
      const main = container.querySelector('svg')!.getAttribute('data-main')!;
      const t = SCHEMES[scheme];
      for (const backdrop of [
        t.category[ILLUSTRATIONS[name].category].bg,
        t.surface,
        t.background,
      ]) {
        expect(contrast(main, backdrop), `${main} on ${backdrop}`).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

describe('scheme', () => {
  it('follows the scheme the app shows when none is given', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { container } = renderUi(<Illustration name="bottle" />);
    expect(container.querySelector('svg')!.getAttribute('data-scheme')).toBe('light');
  });

  it('falls back to dark outside the theme provider', () => {
    const { container } = render(<Illustration name="bottle" />);
    expect(container.querySelector('svg')!.getAttribute('data-scheme')).toBe('dark');
  });

  it('gives light and dark different colours from their category tokens', () => {
    const { container } = render(
      <>
        <Illustration name="diaper" scheme="light" />
        <Illustration name="diaper" scheme="dark" />
      </>,
    );
    const [light, dark] = container.querySelectorAll('svg');
    expect(light.getAttribute('data-main')).not.toBe(dark.getAttribute('data-main'));
  });
});

describe('registry', () => {
  const builtInTypeKeys = [
    ...readFileSync(
      resolve(process.cwd(), '../api/src/Lotties.Domain/EventTypes/BuiltInEventTypes.cs'),
      'utf8',
    ).matchAll(/EventTypeKey\.From\("([a-z_]+)"\)/g),
  ].map((m) => m[1]);
  const sleepKinds = SLEEP_DTO.fields!.find((f) => f.key === 'kind')!.options!;
  const feedingMethods = FEEDING_DTO.fields!.find((f) => f.key === 'method')!.options!;
  /** Built-in types and presets with no drawing yet: their type icon in the category tile. */
  const withoutDrawing: readonly string[] = ['nasal_suction', 'belly_massage', 'fussy'];
  const drawn = (keys: readonly string[]) => keys.filter((key) => !withoutDrawing.includes(key));

  it.each([
    ['built-in preset id', drawn(BUILT_IN_PRESETS.map((p) => p.id))],
    ['built-in event type key', drawn(builtInTypeKeys)],
    ['sleep kind', sleepKinds],
    ['feeding method', feedingMethods],
  ])('resolves every %s to an illustration', (_label, keys) => {
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const known = illustrationName(key);
      expect(known, key).toBeDefined();
      expect(illustrationFor(key), key).toBe(ILLUSTRATIONS[known!].component);
    }
  });

  it('falls back to the icon tile for the built-ins without a drawing yet', () => {
    for (const key of withoutDrawing) {
      expect(builtInTypeKeys, key).toContain(key);
      expect(illustrationName(key), key).toBeUndefined();
      expect(illustrationFor(key), key).toBe(FallbackIllustration);
    }
  });

  it('knows the eleven built-in types of the API', () => {
    expect([...builtInTypeKeys].sort()).toEqual(
      [
        'bath',
        'belly_massage',
        'belly_pain',
        'breast_pump',
        'diaper',
        'feeding',
        'fussy',
        'medication',
        'nasal_suction',
        'sleep',
        'tummy_time',
      ].sort(),
    );
  });

  it('maps the sleep kinds to their own drawings', () => {
    expect(illustrationName('nap')).toBe('nap');
    expect(illustrationName('night')).toBe('night');
    expect(illustrationName('woke_up')).toBe('woke_up');
    expect(illustrationName('wake_up')).toBe('woke_up');
    expect(illustrationName('bed_time')).toBe('bedtime');
    expect(illustrationName('fell_asleep')).toBe('fell_asleep');
    expect(illustrationName('night_waking')).toBe('night_waking');
  });

  it('falls back to the category icon for unknown keys and inherited members', () => {
    for (const key of ['', 'unknown', 'constructor', '__proto__', 'toString']) {
      expect(illustrationName(key), key).toBeUndefined();
      expect(illustrationFor(key), key).toBe(FallbackIllustration);
    }
  });
});

describe('Illustration', () => {
  it('draws the illustration of a key', () => {
    const { container } = renderUi(<Illustration name="breast_pump" size={32} glow />);
    expect(container.querySelector('svg')!.getAttribute('data-illustration')).toBe('pumping');
  });

  it('draws the fallback tile with the given icon, size and name for unknown keys', () => {
    renderUi(
      <Illustration name="my_custom_type" size={64} fallbackIcon="star" title="Sunscreen" />,
    );
    const image = screen.getByRole('img', { name: 'Sunscreen' });
    expect(image.getAttribute('data-icon')).toBe('star');
    const tile = image.parentElement!;
    expect(getComputedStyle(tile).width).toBe('64px');
    expect(getComputedStyle(tile).borderRadius).toBe('50%');
  });

  it('keeps the fallback decorative without a title', () => {
    const { container } = renderUi(<Illustration name="nothing" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-icon')).toBe('event');
  });
});
