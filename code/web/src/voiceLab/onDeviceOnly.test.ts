import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Speech is recognised on the phone only (docs/design/49a-voice-lab.md): no code path in the web app or
 * the native plugins can start a server recogniser or a Web Speech recogniser. Reads the sources as
 * text: the native code cannot be compiled here.
 */

const SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(SRC, '..', '..', '..');
const read = (file: string) => readFileSync(path.resolve(REPO, file), 'utf8');
const ANDROID =
  'code/mobile/android/app/src/main/java/app/lotties/app/speech/LottiesSpeechPlugin.kt';
const IOS = 'code/mobile/ios/App/App/LottiesSpeechPlugin.swift';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('on-device recognition only', () => {
  it('no web source uses the Web Speech recogniser', () => {
    const users = sources(SRC)
      .filter((file) => /SpeechRecognition\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
    expect(users).toEqual([]);
  });

  it('the web adapter always asks the plugin for on-device recognition', () => {
    // Code only: the comments describe the refused `onDevice: false`.
    const adapter = readFileSync(path.join(SRC, 'platform', 'speech.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(adapter).toContain('onDevice: true,');
    expect(adapter).not.toMatch(/onDevice: (false|kind|!)/);
  });

  it('the Android plugin only creates the on-device recogniser and refuses anything else', () => {
    const plugin = read(ANDROID);
    expect(plugin).toContain('SpeechRecognizer.createOnDeviceSpeechRecognizer(context)');
    expect(plugin).not.toMatch(/SpeechRecognizer\.createSpeechRecognizer\(/);
    expect(plugin).toMatch(/getBoolean\("onDevice", true\) == false[\s\S]{0,200}"not_supported"/);
    expect(plugin).toContain('putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)');
  });

  it('the iOS plugin always requires on-device recognition and refuses anything else', () => {
    const plugin = read(IOS);
    expect(plugin).toContain('speech.requiresOnDeviceRecognition = true');
    expect(plugin).not.toMatch(/requiresOnDeviceRecognition = (?!true)/);
    expect(plugin).toMatch(/getBool\("onDevice"\) == false[\s\S]{0,200}"not_supported"/);
  });
});
