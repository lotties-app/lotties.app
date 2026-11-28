import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { voiceLabEnabled, voiceLabFlagOn } from './featureFlag';

/*
 * The voice lab is compiled only with VITE_VOICE_LAB=true (docs/design/49a-voice-lab.md): this build
 * (the tests run without the flag) has no /lab/voice route and no Settings line, and the app's static
 * import graph never reaches the lab, the speech engines or the parser. The production bundle itself
 * is checked by building it (the design doc names the command).
 */

const SRC = path.resolve(__dirname, '..');
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec.split('?')[0]);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
}

/** Files reached from `entry` by static imports (dynamic import() is not followed: lazy chunks). */
function staticGraph(entry: string): string[] {
  const files = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (!match[1].startsWith('.')) continue;
      const resolved = resolveLocal(file, match[1]);
      if (resolved) queue.push(resolved);
    }
  }
  return [...files].map((file) => path.relative(SRC, file).replace(/\\/g, '/'));
}

describe('the voice lab switch', () => {
  it('is on only for the exact value true', () => {
    expect(voiceLabFlagOn({ VITE_VOICE_LAB: 'true' })).toBe(true);
    expect(voiceLabFlagOn({ VITE_VOICE_LAB: '1' })).toBe(false);
    expect(voiceLabFlagOn({})).toBe(false);
    expect(voiceLabEnabled()).toBe(false);
  });

  it('keeps the lab, the speech engines and the parser out of the app entry', () => {
    const reached = staticGraph(path.join(SRC, 'main.tsx'));
    expect(reached.length).toBeGreaterThan(50);
    const lab = reached.filter(
      (file) =>
        file.startsWith('voiceLab/') ||
        file.startsWith('voice/') ||
        /^platform\/(speech|speechTypes|webSpeech)\.ts$/.test(file),
    );
    expect(lab).toEqual([]);
  });

  it('loads the page and the Settings line only behind the inline build-time comparison', () => {
    const guard = (file: string, target: string) =>
      new RegExp(
        String.raw`import\.meta\.env\.VITE_VOICE_LAB === 'true'\s*\?\s*lazy\(\(\) => import\('${target}'\)\)\s*:\s*null`,
      ).test(readFileSync(path.join(SRC, file), 'utf8'));
    expect(guard('AppRoutes.tsx', './voiceLab/VoiceLabPage')).toBe(true);
    expect(guard('pages/SettingsPage.tsx', '../voiceLab/VoiceLabLink')).toBe(true);
    const importers = ['AppRoutes.tsx', 'pages/SettingsPage.tsx'].filter((file) =>
      /from '\.{1,2}\/voiceLab\//.test(readFileSync(path.join(SRC, file), 'utf8')),
    );
    expect(importers).toEqual([]);
  });
});

describe('a build without the voice lab', () => {
  let db: BabyRoutineDb;

  beforeEach(() => {
    db = testDatabase();
  });

  afterEach(async () => {
    await settleSync();
    await db.delete();
  });

  it('has no Settings line to it and no /lab/voice page', async () => {
    await seedBaby(db);
    const settings = renderWithDb(db, <AppRoutes />, { route: '/settings#voice-assistants' });
    expect(
      await screen.findByRole('link', { name: 'Voice commands: what you can say' }),
    ).toBeTruthy();
    expect(screen.queryByTestId('voice-lab-link')).toBeNull();
    settings.unmount();

    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    await settleSync();
    expect(screen.queryByTestId('voice-lab')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Voice lab' })).toBeNull();
  });
});
