/*
 * Browser and system names for the device label ("Chrome on Android"), parsed from the user agent.
 * Product names are proper nouns; the sentence around them comes from the catalog.
 */

export interface DeviceParts {
  browser: string;
  os: string;
}

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|OPiOS\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPod/, 'iOS'],
  [/iPad/, 'iPadOS'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const first = (table: [RegExp, string][], userAgent: string) =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1];

/** `null` when the browser or the system is not recognised (the label is then left out). */
export function deviceParts(userAgent: string, maxTouchPoints = 0): DeviceParts | null {
  const browser = first(BROWSERS, userAgent);
  let os = first(SYSTEMS, userAgent);
  // iPadOS Safari reports a Mac user agent; a touch screen tells them apart.
  if (os === 'macOS' && maxTouchPoints > 1) os = 'iPadOS';
  return browser && os ? { browser, os } : null;
}
