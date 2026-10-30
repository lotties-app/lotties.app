import type { GuideId, InstallPlatform } from './installPlatform';

/** The drawing next to the steps: which device, where the button is and what it looks like. */
export type HintDevice = 'phone' | 'tablet' | 'desktop';
export type HintSpot = 'bottom' | 'bottom-right' | 'top-right' | 'top-left';
export type HintGlyph = 'share' | 'dots' | 'lines' | 'install' | 'menu-bar';

export interface Hint {
  device: HintDevice;
  spot: HintSpot;
  glyph: HintGlyph;
}

/** Step texts live in `install.guide.<id>.*` (en and pt-BR); the lists below are the order. */
export const GUIDES = {
  iosSafari: {
    hint: { device: 'phone', spot: 'bottom', glyph: 'share' },
    steps: [
      'install.guide.iosSafari.s1',
      'install.guide.iosSafari.s2',
      'install.guide.iosSafari.s3',
    ],
  },
  iosOther: {
    hint: { device: 'phone', spot: 'top-right', glyph: 'share' },
    steps: [
      'install.guide.iosOther.s1',
      'install.guide.iosSafari.s2',
      'install.guide.iosSafari.s3',
    ],
  },
  inApp: {
    hint: { device: 'phone', spot: 'top-right', glyph: 'dots' },
    steps: ['install.guide.inApp.s1', 'install.guide.inApp.s2', 'install.guide.inApp.s3'],
  },
  androidChrome: {
    hint: { device: 'phone', spot: 'top-right', glyph: 'dots' },
    steps: [
      'install.guide.androidChrome.s1',
      'install.guide.androidChrome.s2',
      'install.guide.androidChrome.s3',
    ],
  },
  androidSamsung: {
    hint: { device: 'phone', spot: 'bottom-right', glyph: 'lines' },
    steps: [
      'install.guide.androidSamsung.s1',
      'install.guide.androidSamsung.s2',
      'install.guide.androidSamsung.s3',
    ],
  },
  androidFirefox: {
    hint: { device: 'phone', spot: 'top-right', glyph: 'dots' },
    steps: [
      'install.guide.androidFirefox.s1',
      'install.guide.androidFirefox.s2',
      'install.guide.androidFirefox.s3',
    ],
  },
  desktopChromium: {
    hint: { device: 'desktop', spot: 'top-right', glyph: 'install' },
    steps: [
      'install.guide.desktopChromium.s1',
      'install.guide.desktopChromium.s2',
      'install.guide.desktopChromium.s3',
    ],
  },
  macSafari: {
    hint: { device: 'desktop', spot: 'top-left', glyph: 'menu-bar' },
    steps: [
      'install.guide.macSafari.s1',
      'install.guide.macSafari.s2',
      'install.guide.macSafari.s3',
    ],
  },
  unsupported: {
    hint: null,
    steps: ['install.guide.unsupported.s1', 'install.guide.unsupported.s2'],
  },
} as const satisfies Record<GuideId, { hint: Hint | null; steps: readonly string[] }>;

export type StepKey =
  (typeof GUIDES)[GuideId]['steps'][number] | 'install.guide.iosSafari.s1Tablet';

/**
 * The guide for one platform. On iPad, Safari's Share button sits at the top right, next to the
 * address bar, so the first step and the drawing change.
 */
export function guideView(
  id: GuideId,
  platform: InstallPlatform,
): { hint: Hint | null; steps: readonly StepKey[] } {
  const guide = GUIDES[id];
  if (id === 'iosSafari' && platform.tablet) {
    return {
      hint: { device: 'tablet', spot: 'top-right', glyph: 'share' },
      steps: [
        'install.guide.iosSafari.s1Tablet',
        GUIDES.iosSafari.steps[1],
        GUIDES.iosSafari.steps[2],
      ],
    };
  }
  if (id === 'iosOther' && platform.tablet) {
    return { hint: { device: 'tablet', spot: 'top-right', glyph: 'share' }, steps: guide.steps };
  }
  return guide;
}
