import type { BabyEvent, EventType } from '../db/models';
import { sleepSessionKind, typeIdsForKey } from '../now/eventFacts';
import type { CategoryName } from '../theme/tokens';
import type { IconName } from '../ui/icons';

/*
 * The Insights catalogue (docs/DESIGN.md "Insights v1"): every insight names the event types it
 * reads, how many DAYS WITH DATA it needs (distinct local calendar days with at least one relevant
 * event) and a minimum number of relevant events. Pure data plus the relevance rule; readiness.ts
 * turns it into progress and an estimate, the screen into rows and cards.
 */

export type InsightId = 'sleep' | 'sleepRhythm' | 'feeding' | 'diapers';

export interface InsightDefinition {
  id: InsightId;
  /** Built-in event type keys the insight reads. */
  typeKeys: readonly string[];
  /** Distinct local days with a relevant event needed before the insight opens. */
  minDays: number;
  /** Relevant events needed before the insight opens. */
  minEvents: number;
  icon: IconName;
  category: CategoryName;
  /** Whether a live event of one of `typeKeys` counts toward this insight. */
  counts: (event: BabyEvent) => boolean;
}

/** Sleep sessions (naps and nights); markers and night wakings are not sleep. */
const isSleepSession = (event: BabyEvent) => sleepSessionKind(event) !== null;
const any = () => true;

export const INSIGHTS: readonly InsightDefinition[] = [
  {
    id: 'sleep',
    typeKeys: ['sleep'],
    minDays: 3,
    minEvents: 3,
    icon: 'moon',
    category: 'sleep',
    counts: isSleepSession,
  },
  {
    id: 'sleepRhythm',
    typeKeys: ['sleep'],
    minDays: 7,
    minEvents: 7,
    icon: 'sunrise',
    category: 'sleep',
    counts: isSleepSession,
  },
  {
    id: 'feeding',
    typeKeys: ['feeding'],
    minDays: 3,
    minEvents: 6,
    icon: 'bottle',
    category: 'feeding',
    counts: any,
  },
  {
    id: 'diapers',
    typeKeys: ['diaper'],
    minDays: 3,
    minEvents: 6,
    icon: 'diaper',
    category: 'diaper',
    counts: any,
  },
];

/**
 * The Formulas card is not in the readiness catalogue: it opens per formula (7 days and 20
 * bottles, `formulaComparison.ts`), so it only shares the card's look.
 */
export interface FormulasInsight {
  id: 'formulas';
  icon: IconName;
  category: CategoryName;
}

export const FORMULAS_INSIGHT: FormulasInsight = {
  id: 'formulas',
  icon: 'bottle',
  category: 'feeding',
};

export function insightById(id: InsightId): InsightDefinition {
  const found = INSIGHTS.find((insight) => insight.id === id);
  if (!found) throw new Error(`Unknown insight ${id}`);
  return found;
}

/** Live events (not deleted, started by `now`) that count toward `insight`. */
export function relevantEvents(
  insight: InsightDefinition,
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): BabyEvent[] {
  const ids = new Set(insight.typeKeys.flatMap((key) => [...typeIdsForKey(types, key)]));
  const nowIso = now.toISOString();
  return events.filter(
    (event) =>
      event.deletedAt === null &&
      event.startedAt <= nowIso &&
      ids.has(event.typeId) &&
      insight.counts(event),
  );
}
