import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Drift guard of the iOS privacy manifests (PrivacyInfo.xcprivacy of the app and of the widget extension; App Store
 * review rejects a build without one). Reads the files as text: no Xcode here. Re-verify a real archive with
 * Xcode > Product > Archive > Generate Privacy Report.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const IOS = 'code/mobile/ios/App';
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

const APP_MANIFEST = `${IOS}/App/PrivacyInfo.xcprivacy`;
const WIDGET_MANIFEST = `${IOS}/LottiesWidgets/PrivacyInfo.xcprivacy`;

/** Required-reason API categories and their reason codes, as declared. */
const accessedApis = (plist: string): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  const entries = plist.matchAll(
    /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>(\w+)<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>([\s\S]*?)<\/array>/g,
  );
  for (const [, category, reasons] of entries) {
    result[category] = [...reasons.matchAll(/<string>([\w.]+)<\/string>/g)].map((m) => m[1]);
  }
  return result;
};

const collectedTypes = (plist: string): string[] =>
  [...plist.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>(\w+)<\/string>/g)].map((m) => m[1]);

const swiftSources = (dir: string): string =>
  readdirSync(resolve(REPO, dir))
    .filter((name) => name.endsWith('.swift'))
    .map((name) => read(`${dir}/${name}`))
    .join('\n');

describe('iOS privacy manifests', () => {
  it.each([APP_MANIFEST, WIDGET_MANIFEST])('%s declares no tracking and no tracking domain', (path) => {
    const plist = read(path);
    expect(plist).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  });

  it('the app declares the App Group UserDefaults and the file timestamps of @capacitor/filesystem', () => {
    expect(accessedApis(read(APP_MANIFEST))).toEqual({
      NSPrivacyAccessedAPICategoryUserDefaults: ['1C8F.1'],
      NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1'],
    });
  });

  it('the widget extension declares only the App Group UserDefaults and collects nothing itself', () => {
    const plist = read(WIDGET_MANIFEST);
    expect(accessedApis(plist)).toEqual({ NSPrivacyAccessedAPICategoryUserDefaults: ['1C8F.1'] });
    expect(collectedTypes(plist)).toEqual([]);
  });

  it('the app declares the collected data of the store forms, all linked, none for tracking', () => {
    const plist = read(APP_MANIFEST);
    expect(collectedTypes(plist).sort()).toEqual(
      [
        'NSPrivacyCollectedDataTypeDeviceID',
        'NSPrivacyCollectedDataTypeEmailAddress',
        'NSPrivacyCollectedDataTypeHealth',
        'NSPrivacyCollectedDataTypeName',
        'NSPrivacyCollectedDataTypeOtherDataTypes',
        'NSPrivacyCollectedDataTypeOtherUserContent',
        'NSPrivacyCollectedDataTypeUserID',
      ].sort(),
    );
    expect(plist).not.toMatch(/<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
    expect(plist).not.toMatch(/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<false\/>/);
  });

  it('UserDefaults in the Swift sources is only the App Group suite (reason 1C8F.1, not CA92.1)', () => {
    const sources = [`${IOS}/App`, `${IOS}/Shared`, `${IOS}/LottiesWidgets`].map(swiftSources).join('\n');
    const uses = [...sources.matchAll(/UserDefaults[.(]\w*/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((use) => use === 'UserDefaults(suiteName')).toBe(true);
  });

  it('each manifest is a bundle resource of its own target', () => {
    const project = read(`${IOS}/App.xcodeproj/project.pbxproj`);
    const resources = (phaseId: string) =>
      new RegExp(`${phaseId} /\\* Resources \\*/ = \\{[^}]*?PrivacyInfo\\.xcprivacy in Resources`).test(project);
    expect(resources('504EC3021FED79650016851F')).toBe(true); // App
    expect(resources('C0DE00000000000000000019')).toBe(true); // LottiesWidgets
  });

  it('the app has a launch screen', () => {
    expect(read(`${IOS}/App/Info.plist`)).toMatch(
      /<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/,
    );
    expect(read(`${IOS}/App/Base.lproj/LaunchScreen.storyboard`)).toContain('launchScreen="YES"');
  });
});
