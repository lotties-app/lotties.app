import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EVENT_ICON_NAMES, ICONS, eventTypeIconName } from '../events/iconRegistry';
import { presetIcon } from '../presets/presetIcons';
import { CATEGORY_NAMES } from '../theme/tokens';
import { renderUi } from '../test/renderUi';
import { CategoryIcon } from './CategoryIcon';
import { Icon } from './Icon';
import { ICON_COMPONENTS, type IconName } from './icons';

describe('Icon', () => {
  it('is decorative by default, 24 px with a 1.5 stroke in currentColor', () => {
    const { container } = renderUi(<Icon name="bottle" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
  });

  it('is an image with a name when a label is given', () => {
    renderUi(<Icon name="cloud-off" label="Offline" size={16} />);
    const image = screen.getByRole('img', { name: 'Offline' });
    expect(image.getAttribute('width')).toBe('16');
    expect(image.getAttribute('aria-hidden')).toBeNull();
  });

  it('falls back to a neutral glyph for an unknown name', () => {
    const { container } = renderUi(<Icon name={'constructor' as IconName} />);
    expect(container.querySelector('[data-icon="constructor"]')).not.toBeNull();
    expect(container.querySelector('svg path')).not.toBeNull();
  });

  it('renders every registered icon', () => {
    for (const name of Object.keys(ICON_COMPONENTS) as IconName[]) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector(`svg[data-icon="${name}"] path`), name).not.toBeNull();
      unmount();
    }
  });
});

describe('CategoryIcon', () => {
  it('draws the icon in the tinted category circle', () => {
    for (const category of CATEGORY_NAMES) {
      const { container, unmount } = renderUi(<CategoryIcon name="moon" category={category} />);
      const circle = container.querySelector('svg')!.parentElement!;
      const style = getComputedStyle(circle);
      expect(style.borderRadius).toBe('50%');
      expect(style.width).toBe('44px');
      unmount();
    }
  });
});

describe('event type icon names', () => {
  const allowlist = [
    ...readFileSync(
      resolve(process.cwd(), '../api/src/Lotties.Domain/EventTypes/EventTypeIcons.cs'),
      'utf8',
    ).matchAll(/^\s+"([a-z_]+)",?$/gm),
  ].map((m) => m[1]);

  it('maps every icon name the API allows to a Tabler icon', () => {
    expect(allowlist.length).toBeGreaterThan(10);
    for (const name of allowlist) expect(ICONS.has(name), name).toBe(true);
    expect([...EVENT_ICON_NAMES].sort()).toEqual([...allowlist].sort());
  });

  it('never resolves inherited object members', () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(eventTypeIconName(name)).toBe('event');
    }
    expect(presetIcon({ icon: 'constructor', builtIn: true })).toBe('event');
    expect(presetIcon({ icon: 'nap', builtIn: true })).toBe('zzz');
  });
});
