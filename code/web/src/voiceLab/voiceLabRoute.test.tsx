import { screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Before any import below runs: this file is the lab build (VITE_VOICE_LAB=true).
vi.hoisted(() => {
  vi.stubEnv('VITE_VOICE_LAB', 'true');
});

import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { voiceLabEnabled } from './featureFlag';

/* The lab build (docs/design/49a-voice-lab.md): one line in Settings > Voice assistants, the /lab/voice page. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('a build with the voice lab', () => {
  it('shows the line in Settings > Voice assistants and opens the lab at /lab/voice', async () => {
    expect(voiceLabEnabled()).toBe(true);
    await seedBaby(db);
    const settings = renderWithDb(db, <AppRoutes />, { route: '/settings#voice-assistants' });
    const link = await screen.findByRole('link', { name: 'Open the voice lab' });
    expect(link.getAttribute('href')).toBe('/lab/voice');
    settings.unmount();

    renderWithDb(db, <AppRoutes />, { route: '/lab/voice' });
    expect(await screen.findByRole('heading', { name: 'Voice lab', level: 1 })).toBeTruthy();
    expect(screen.getByText('mamadeira de 120 ml')).toBeTruthy();
  });
});
