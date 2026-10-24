import { useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { dayKeyOf } from '../appointments/calendarModel';
import { SelectedBabyContext, type SelectedBaby } from '../baby/SelectedBabyContext';
import CryMonitorPage from '../cryMonitor/CryMonitorPage';
import { FakeCryEngine, type FakeCryEngineOptions } from '../cryMonitor/fakeCryEngine';
import { clearCryMonitorConsent, writeConsent } from '../cryMonitor/monitorStorage';
import type { WakeLockEnvironment } from '../cryMonitor/screenWakeLock';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent } from '../db/models';
import { fakePushDevice } from '../notifications/fakePush';
import { PushDeviceContext } from '../notifications/PushDeviceContext';
import { FUSSY_TYPE } from '../test/builtInTypes';
import { addDays } from '../vaccines/vaccineStatus';
import { PREVIEW_BABY_ID, PREVIEW_TYPES } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/cry-monitor`, never in production builds): the cry monitor page
 * (docs/design/35-cry-engine.md section 8) in every state over a throw-away local database and a
 * scripted engine (no microphone, no model). `?state=intro` (consent given), `consent`, `loading`,
 * `listening` (a cry heard 4 minutes ago, the meter half full), `denied`, `lost`, `stalled`,
 * `unsupported`; `&scheme=light|dark|night`. Two monitor spells of today feed the recent detections.
 */

const SCENARIOS = [
  'intro',
  'consent',
  'loading',
  'listening',
  'denied',
  'lost',
  'stalled',
  'unsupported',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const MIN = 60_000;

const BABY: Baby = {
  id: PREVIEW_BABY_ID,
  name: 'Lia',
  birthDate: addDays(dayKeyOf(Date.now()), -82),
  role: 'Owner',
  userId: 'dev-me',
};

function spell(id: string, minutesAgo: number, length: number, payload: BabyEvent['payload']) {
  const startedAt = new Date(Date.now() - minutesAgo * MIN).toISOString();
  return {
    id,
    babyId: PREVIEW_BABY_ID,
    typeId: FUSSY_TYPE.id,
    startedAt,
    endedAt: new Date(Date.now() - (minutesAgo - length) * MIN).toISOString(),
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  } satisfies BabyEvent;
}

async function seed(db: BabyRoutineDb) {
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.outbox.clear(),
  ]);
  await db.babies.put(BABY);
  await db.eventTypes.bulkPut([...PREVIEW_TYPES, FUSSY_TYPE]);
  // Only spells of today show; early in the day these may fall on yesterday.
  const minutes = Math.min(150, new Date().getHours() * 60 + new Date().getMinutes() - 5);
  if (minutes > 30) {
    await db.events.bulkPut([
      spell('dev-cry-1', minutes, 12, { auto_detected: true, cry_confirmed: true }),
      spell('dev-cry-2', Math.round(minutes / 2), 6, { auto_detected: true }),
    ]);
  }
}

function engineFor(scenario: Scenario): FakeCryEngine {
  const outcome: FakeCryEngineOptions['outcome'] =
    scenario === 'loading' ? 'pending' : scenario === 'denied' ? 'denied' : 'listening';
  const engine = new FakeCryEngine({ outcome });
  engine.on('state', ({ state }) => {
    if (state !== 'listening') return;
    // Let the page render the listening view first.
    setTimeout(() => {
      const now = Date.now();
      if (scenario === 'listening') {
        engine.emit('cry_started', { type: 'cry_started', at: now - 4 * MIN, detectedAt: now });
        engine.emit('score', { t: now - 975, score: 0.02, smoothed: 0.02, inferenceMs: 5 });
      }
      if (scenario === 'lost') engine.lose();
      if (scenario === 'stalled') engine.emit('stalled', { at: now, lastFrameAt: now - 6_000 });
    }, 0);
  });
  return engine;
}

const WAKE_LOCK: WakeLockEnvironment = {
  wakeLock: { request: async () => ({ released: false, release: async () => undefined }) },
  visibility: () => 'visible',
  onVisibilityChange: () => () => undefined,
};

/** Developer-only: the cry monitor page in one state (`/dev/cry-monitor?state=listening`). */
export default function CryMonitorPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'intro';
  const [db] = useState(() => createDatabase('dev-cry-monitor-preview'));
  const [push] = useState(() => fakePushDevice({ permission: 'granted', subscribed: true }));
  const [ready, setReady] = useState<Scenario | null>(null);
  // One engine per scenario (a new function each render would start it again).
  const createEngine = useMemo(() => {
    const engine = engineFor(scenario);
    return async () => engine;
  }, [scenario]);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (scenario === 'consent') clearCryMonitorConsent();
      else writeConsent();
      await seed(db);
      if (live) setReady(scenario);
    })();
    return () => {
      live = false;
    };
  }, [db, scenario]);

  const selected: SelectedBaby = {
    babies: ready ? [BABY] : undefined,
    baby: ready ? BABY : undefined,
    select: () => undefined,
  };
  return (
    <DatabaseProvider db={db}>
      <PushDeviceContext value={push}>
        <SelectedBabyContext value={selected}>
          <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
            <Box component="main" sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: 4 }}>
              {ready === scenario && (
                <CryMonitorPage
                  key={scenario}
                  createEngine={createEngine}
                  wakeLockEnvironment={WAKE_LOCK}
                  supported={scenario !== 'unsupported'}
                  autoStart={!['intro', 'unsupported'].includes(scenario)}
                />
              )}
              <PreviewToolbar
                scenarios={SCENARIOS}
                scenario={scenario}
                onScenario={(next) => setParams({ state: next }, { replace: true })}
              />
            </Box>
          </Box>
        </SelectedBabyContext>
      </PushDeviceContext>
    </DatabaseProvider>
  );
}
