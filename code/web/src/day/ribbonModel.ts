import type { BabyEvent, EventType } from '../db/models';
import { sleepSessionKind, typeIdsForKey } from '../now/eventFacts';
import { typeCategory } from '../now/typeVisual';
import type { CategoryName } from '../theme/tokens';
import { effectiveDurationMs } from '../timers/pauseMath';
import type { DayBounds } from './dayModel';

/*
 * What the 24-hour ribbon of the Day screen draws, as fractions (0 to 1) of the day: sleep
 * stretches (naps, nights, night wakings) and sleep markers (woke up, bedtime) in the sleep lane,
 * every other event of the day as a mark in the events lane. Pure and language-free; pixel work
 * (clustering, label fit) lives in `ribbonGeometry.ts`.
 */

export type SleepBlockKind = 'nap' | 'night' | 'nightWaking';

/** A stretch of the sleep lane. */
export interface RibbonBlock {
  id: string;
  event: BabyEvent;
  from: number;
  to: number;
  kind: SleepBlockKind;
  category: 'sleep' | 'nightWaking';
  running: boolean;
  /** Effective length of the whole event (pauses left out), running ones until `now`. */
  durationMs: number;
}

export type RibbonLane = 'sleep' | 'events';

/** A point on the ribbon: an instant sleep marker or any other event, at its start. */
export interface RibbonMark {
  id: string;
  event: BabyEvent;
  at: number;
  category: CategoryName;
  lane: RibbonLane;
}

export interface RibbonModel {
  /** Sleep stretches by start; night wakings after the sleep they interrupt (drawn on top). */
  blocks: RibbonBlock[];
  /** Marks of both lanes by time. */
  marks: RibbonMark[];
}

const isNightWaking = (event: BabyEvent) =>
  Object.hasOwn(event.payload, 'kind') && event.payload.kind === 'night_waking';

const byTime =
  <T extends { id: string }>(position: (item: T) => number) =>
  (a: T, b: T) =>
    position(a) - position(b) || a.id.localeCompare(b.id);

/** The ribbon of a day from the events loaded for it (see `queryRange` in dayModel). */
export function ribbonModel(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  bounds: DayBounds,
  now: Date,
): RibbonModel {
  const startMs = bounds.start.getTime();
  const endMs = bounds.end.getTime();
  const length = endMs - startMs;
  const ratio = (ms: number) => Math.min(1, Math.max(0, (ms - startMs) / length));
  const sleepIds = typeIdsForKey(types, 'sleep');
  const byId = new Map(types.map((type) => [type.id, type]));
  const blocks: RibbonBlock[] = [];
  const marks: RibbonMark[] = [];

  for (const event of events) {
    if (event.deletedAt !== null) continue;
    const begin = Date.parse(event.startedAt);
    const finish = event.endedAt === null ? now.getTime() : Date.parse(event.endedAt);
    const inDay = begin >= startMs && begin < endMs;

    if (sleepIds.has(event.typeId)) {
      const waking = isNightWaking(event);
      const session = sleepSessionKind(event);
      const from = Math.max(begin, startMs);
      const to = Math.min(finish, endMs);
      if ((session !== null || waking) && to > from) {
        blocks.push({
          id: event.id,
          event,
          from: ratio(from),
          to: ratio(to),
          kind: waking ? 'nightWaking' : (session ?? 'nap'),
          category: waking ? 'nightWaking' : 'sleep',
          running: event.endedAt === null,
          durationMs: effectiveDurationMs(event, now),
        });
      } else if (inDay) {
        marks.push({
          id: event.id,
          event,
          at: ratio(begin),
          category: waking ? 'nightWaking' : 'sleep',
          lane: 'sleep',
        });
      }
      continue;
    }
    if (!inDay) continue;
    marks.push({
      id: event.id,
      event,
      at: ratio(begin),
      category: typeCategory(byId.get(event.typeId)),
      lane: 'events',
    });
  }

  blocks.sort((a, b) => {
    const layer = Number(a.kind === 'nightWaking') - Number(b.kind === 'nightWaking');
    return layer || byTime<RibbonBlock>((block) => block.from)(a, b);
  });
  marks.sort(byTime<RibbonMark>((mark) => mark.at));
  return { blocks, marks };
}

/** The filter category an item of the ribbon belongs to (night wakings are part of sleep). */
export const filterCategoryOf = (category: CategoryName): CategoryName =>
  category === 'nightWaking' ? 'sleep' : category;

/** The ribbon with only the items whose category `visible` accepts. */
export function visibleRibbon(
  model: RibbonModel,
  visible: (category: CategoryName) => boolean,
): RibbonModel {
  return {
    blocks: model.blocks.filter((block) => visible(filterCategoryOf(block.category))),
    marks: model.marks.filter((mark) => visible(filterCategoryOf(mark.category))),
  };
}

/** Categories drawn on the ribbon, in no particular order. */
export function ribbonCategories(model: RibbonModel): Set<CategoryName> {
  return new Set<CategoryName>([
    ...model.blocks.map((block) => block.category),
    ...model.marks.map((mark) => mark.category),
  ]);
}
