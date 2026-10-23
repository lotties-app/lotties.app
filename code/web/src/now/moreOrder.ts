import type { BabyEvent } from '../db/models';
import { normalizeText } from '../hub/searchEntries';
import { presetLabel } from '../presets/presetLabel';
import { eventMatchesPreset } from '../presets/status';
import type { Preset } from '../presets/types';

const DAY_MS = 24 * 3_600_000;
/** How far back the More sheet looks at what the person logged. */
export const MORE_USAGE_WINDOW_DAYS = 60;
/** Events this recent count double. */
export const MORE_RECENT_DAYS = 14;
/** Uses in the window a tile needs before it moves up. */
export const MORE_MIN_USES = 2;

/**
 * Whether the event was logged by the signed-in person. `createdBy` stays `null` until the server
 * echoes the event back, and the local store is per account, so a `null` author is this person.
 * Without a known user id only those unsynced events count (never another member's).
 */
function loggedBy(event: BabyEvent, userId: string | null | undefined): boolean {
  if (event.createdBy === null) return true;
  return !!userId && event.createdBy === userId;
}

/**
 * Usage score of each preset: the person's own live events of it started in the last 60 days, the
 * last 14 days counting double. Presets without a type (the Custom link) never score.
 */
function scores(
  presets: readonly Preset[],
  events: readonly BabyEvent[],
  userId: string | null | undefined,
  now: Date,
): Map<string, { uses: number; score: number }> {
  const nowMs = now.getTime();
  const windowStart = nowMs - MORE_USAGE_WINDOW_DAYS * DAY_MS;
  const recentStart = nowMs - MORE_RECENT_DAYS * DAY_MS;
  const result = new Map<string, { uses: number; score: number }>();
  for (const event of events) {
    if (event.deletedAt !== null || !loggedBy(event, userId)) continue;
    const started = Date.parse(event.startedAt);
    if (!Number.isFinite(started) || started < windowStart) continue;
    for (const preset of presets) {
      if (preset.typeId === null || preset.mode === 'link') continue;
      if (!eventMatchesPreset(preset, event)) continue;
      const entry = result.get(preset.id) ?? { uses: 0, score: 0 };
      entry.uses += 1;
      entry.score += started >= recentStart ? 2 : 1;
      result.set(preset.id, entry);
    }
  }
  return result;
}

/**
 * Whether a tile name matches the More sheet search: every typed word appears somewhere in the
 * name, in any order, ignoring case and accents ("agua" finds "Água", "time tum" finds "Tummy
 * time"). An empty query matches everything.
 */
export function moreTileMatches(query: string, name: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeText(name);
  return words.every((word) => haystack.includes(word));
}

/**
 * The More sheet order (docs/DESIGN.md "More sheet order"): the tiles the person logs most come
 * first (at least 2 own uses in the last 60 days; by score, the last 14 days counting double, ties
 * by name), then every other tile by its localized name (accent-insensitive, numeric). The Custom
 * link tile stays last. Pure and deterministic: the same input gives the same order.
 */
export function orderMoreTypes(
  presets: readonly Preset[],
  events: readonly BabyEvent[],
  userId: string | null | undefined,
  now: Date,
  locale: string,
  labelOf: (preset: Preset) => string = presetLabel,
): Preset[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const usage = scores(presets, events, userId, now);
  const labels = new Map(presets.map((p) => [p.id, labelOf(p)]));
  const byName = (a: Preset, b: Preset) =>
    collator.compare(labels.get(a.id) ?? '', labels.get(b.id) ?? '') ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const links = presets.filter((p) => p.mode === 'link');
  const tiles = presets.filter((p) => p.mode !== 'link');
  const promoted = tiles
    .filter((p) => (usage.get(p.id)?.uses ?? 0) >= MORE_MIN_USES)
    .sort((a, b) => (usage.get(b.id)?.score ?? 0) - (usage.get(a.id)?.score ?? 0) || byName(a, b));
  const promotedIds = new Set(promoted.map((p) => p.id));
  const rest = tiles.filter((p) => !promotedIds.has(p.id)).sort(byName);
  return [...promoted, ...rest, ...links];
}
