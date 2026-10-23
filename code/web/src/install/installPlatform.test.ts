import { describe, expect, it } from 'vitest';
import { guideView } from './guides';
import {
  detectInstallPlatform,
  guideFor,
  type GuideId,
  type InstallPlatform,
} from './installPlatform';
import { UA } from './installTestKit';

type Row = [keyof typeof UA, number, Partial<InstallPlatform>, GuideId];

const TABLE: Row[] = [
  [
    'iosSafari',
    5,
    { os: 'ios', browser: 'safari', tablet: false, inAppBrowser: false },
    'iosSafari',
  ],
  ['iosChrome', 5, { os: 'ios', browser: 'chrome' }, 'iosOther'],
  ['iosEdge', 5, { os: 'ios', browser: 'edge' }, 'iosOther'],
  ['iosFirefox', 5, { os: 'ios', browser: 'firefox' }, 'iosOther'],
  ['iosInstagram', 5, { os: 'ios', inAppBrowser: true }, 'inApp'],
  ['ipadSafari', 5, { os: 'ios', browser: 'safari', tablet: true }, 'iosSafari'],
  ['ipadDesktopMode', 5, { os: 'ios', browser: 'safari', tablet: true }, 'iosSafari'],
  ['androidChrome', 5, { os: 'android', browser: 'chrome', inAppBrowser: false }, 'androidChrome'],
  ['androidSamsung', 5, { os: 'android', browser: 'samsung' }, 'androidSamsung'],
  ['androidFirefox', 5, { os: 'android', browser: 'firefox' }, 'androidFirefox'],
  ['androidWebView', 5, { os: 'android', inAppBrowser: true }, 'inApp'],
  ['androidFacebook', 5, { os: 'android', inAppBrowser: true }, 'inApp'],
  ['desktopChrome', 0, { os: 'desktop', browser: 'chrome', mac: false }, 'desktopChromium'],
  ['desktopEdge', 0, { os: 'desktop', browser: 'edge' }, 'desktopChromium'],
  ['macSafari', 0, { os: 'desktop', browser: 'safari', mac: true }, 'macSafari'],
  ['macChrome', 0, { os: 'desktop', browser: 'chrome', mac: true }, 'desktopChromium'],
  ['desktopFirefox', 0, { os: 'desktop', browser: 'firefox' }, 'unsupported'],
];

describe('detectInstallPlatform', () => {
  it.each(TABLE)('%s', (name, touchPoints, expected, guide) => {
    const platform = detectInstallPlatform(UA[name], touchPoints);
    expect(platform).toMatchObject(expected);
    expect(guideFor(platform)).toBe(guide);
  });

  it('treats an empty user agent as a desktop browser it cannot install from', () => {
    const platform = detectInstallPlatform('');
    expect(platform.os).toBe('desktop');
    expect(guideFor(platform)).toBe('unsupported');
  });
});

describe('guideView', () => {
  it('points at the bottom toolbar on iPhone and at the top right on iPad', () => {
    const phone = guideView('iosSafari', detectInstallPlatform(UA.iosSafari, 5));
    expect(phone.hint).toMatchObject({ device: 'phone', spot: 'bottom', glyph: 'share' });
    expect(phone.steps[0]).toBe('install.guide.iosSafari.s1');

    const tablet = guideView('iosSafari', detectInstallPlatform(UA.ipadSafari, 5));
    expect(tablet.hint).toMatchObject({ device: 'tablet', spot: 'top-right' });
    expect(tablet.steps).toEqual([
      'install.guide.iosSafari.s1Tablet',
      'install.guide.iosSafari.s2',
      'install.guide.iosSafari.s3',
    ]);
  });

  it('points at the top right Share for Chrome and Edge on iOS', () => {
    const view = guideView('iosOther', detectInstallPlatform(UA.iosChrome, 5));
    expect(view.hint).toMatchObject({ device: 'phone', spot: 'top-right', glyph: 'share' });
  });

  it('has no drawing for a browser that cannot install', () => {
    expect(guideView('unsupported', detectInstallPlatform(UA.desktopFirefox)).hint).toBeNull();
  });
});
