import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import type { BabyEvent, EventType } from '../db/models';
import { formatDuration } from '../i18n/format';
import { DayRing } from '../now/ui/DayRing';
import { DayRuler } from '../now/ui/DayRuler';
import { RhythmToggle } from '../now/ui/RhythmToggle';
import type { NowView } from '../now/ringPrefs';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/ring`, never in production builds): the day rhythm ring and the
 * ruler at a fixed clock, one state at a time, in the same frame as on the Now card. No database,
 * no sign-in, no server. `?state=ahead|inside|asleep|night|empty|busy`, `&view=ring|ruler`,
 * `&scale=130` (root font size in percent, like a large iOS text size), `&scheme=dark`.
 */

const SCENARIOS = ['ahead', 'inside', 'asleep', 'night', 'empty', 'busy'] as const;
type Scenario = (typeof SCENARIOS)[number];
const TYPES: EventType[] = [SLEEP_TYPE, FEEDING_TYPE, DIAPER_TYPE];
const MIN = 60_000;

const today = new Date();
const at = (h: number, m = 0, dayOffset = 0) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m);

function ev(
  id: string,
  type: EventType,
  from: Date,
  to: Date | null,
  payload: BabyEvent['payload'] = {},
): BabyEvent {
  return {
    id,
    babyId: 'dev-ring',
    typeId: type.id,
    startedAt: from.toISOString(),
    endedAt: to ? to.toISOString() : null,
    payload,
    notes: null,
    createdBy: null,
    createdAt: from.toISOString(),
    updatedAt: from.toISOString(),
    deletedAt: null,
  };
}

const sleep = (id: string, from: Date, to: Date | null, kind: string) =>
  ev(id, SLEEP_TYPE, from, to, { kind });

/** The owner's morning: night, a nap ending 10:19, three feeds and two diapers close together. */
const MORNING: BabyEvent[] = [
  sleep('night', at(19, 30, -1), at(6, 40), 'night'),
  sleep('nap1', at(8, 50), at(10, 19), 'nap'),
  ev('f1', FEEDING_TYPE, at(6, 50), at(7, 5), { method: 'breast', side: 'left' }),
  ev('f2', FEEDING_TYPE, at(10, 25), at(10, 25), { method: 'bottle', amount_ml: 90 }),
  ev('f3', FEEDING_TYPE, at(10, 50), at(10, 50), { method: 'bottle', amount_ml: 30 }),
  ev('d1', DIAPER_TYPE, at(10, 35), at(10, 35), { content: 'WET' }),
];

interface Setup {
  now: Date;
  events: BabyEvent[];
  window?: { earliest: string; latest: string };
  state: 'awake' | 'nap' | 'night';
  since: Date;
}

function setupFor(scenario: Scenario): Setup {
  const window = { earliest: at(11, 20).toISOString(), latest: at(12, 11).toISOString() };
  switch (scenario) {
    case 'ahead':
      return { now: at(11, 11), events: MORNING, window, state: 'awake', since: at(10, 19) };
    case 'inside':
      return { now: at(11, 40), events: MORNING, window, state: 'awake', since: at(10, 19) };
    case 'asleep':
      return {
        now: at(11, 11),
        events: [...MORNING, sleep('run', at(10, 55), null, 'nap')],
        state: 'nap',
        since: at(10, 55),
      };
    case 'night':
      return {
        now: at(21, 30),
        events: [
          ...MORNING,
          sleep('nap2', at(12, 40), at(14, 5), 'nap'),
          sleep('nap3', at(16, 20), at(16, 55), 'nap'),
          sleep('bed', at(19, 35), at(19, 35), 'bed_time'),
          sleep('tonight', at(19, 40), null, 'night'),
          sleep('waking', at(20, 50), at(21, 5), 'night_waking'),
        ],
        state: 'night',
        since: at(19, 40),
      };
    case 'empty':
      return { now: at(11, 11), events: [], state: 'awake', since: at(11, 11) };
    case 'busy':
      return {
        now: at(17, 5),
        events: [
          sleep('night', at(20, 0, -1), at(6, 10), 'night'),
          sleep('w1', at(1, 30), at(1, 50), 'night_waking'),
          sleep('n1', at(7, 40), at(8, 15), 'nap'),
          sleep('n2', at(9, 30), at(10, 40), 'nap'),
          sleep('n3', at(12, 0), at(12, 20), 'nap'),
          sleep('n4', at(12, 45), at(13, 30), 'nap'),
          sleep('n5', at(15, 0), at(15, 40), 'nap'),
          sleep('n6', at(16, 20), at(16, 35), 'nap'),
        ],
        window: { earliest: at(17, 30).toISOString(), latest: at(18, 5).toISOString() },
        state: 'awake',
        since: at(16, 35),
      };
  }
}

/** Developer-only: the ring and the ruler at a fixed clock (route `/dev/ring?state=ahead`). */
export default function RingPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'ahead';
  const [view, setView] = useState<NowView>(params.get('view') === 'ruler' ? 'ruler' : 'ring');
  const scale = Number(params.get('scale') ?? 100);
  const setup = useMemo(() => setupFor(scenario), [scenario]);

  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.fontSize;
    root.style.fontSize = `${scale}%`;
    return () => {
      root.style.fontSize = before;
    };
  }, [scale]);

  const minutes = Math.round((setup.now.getTime() - setup.since.getTime()) / MIN);
  const stateLabel =
    setup.state === 'awake'
      ? t('now.state.awake')
      : setup.state === 'nap'
        ? t('now.state.asleepNap')
        : t('now.state.asleepNight');
  const body =
    view === 'ring' || setup.state !== 'awake' ? (
      <DayRing
        events={setup.events}
        types={TYPES}
        now={setup.now}
        {...(setup.window ? { window: setup.window } : {})}
        stateLabel={stateLabel}
        duration={formatDuration(minutes * MIN)}
      />
    ) : (
      <DayRuler
        since={setup.since.toISOString()}
        now={setup.now}
        {...(setup.window ? { window: setup.window } : {})}
      />
    );

  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
      <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 2, pb: 4 }}>
        <h1 style={{ fontSize: '1rem', margin: '0 0 8px' }}>Ring preview</h1>
        <Card component="section" sx={{ p: 2.5 }} data-testid="ring-card">
          <Box
            sx={(theme) => ({
              p: 1.5,
              borderRadius: `${RADIUS.input}px`,
              backgroundColor:
                setup.state === 'awake' ? palette(theme).surfaceRaised : 'transparent',
            })}
          >
            {body}
            <RhythmToggle view={view} onChange={setView} />
          </Box>
        </Card>
        <Box sx={{ mt: 2 }}>
          <PreviewToolbar
            scenarios={SCENARIOS}
            scenario={scenario}
            onScenario={(next) => setParams({ state: next }, { replace: true })}
          />
        </Box>
      </Box>
    </Box>
  );
}
