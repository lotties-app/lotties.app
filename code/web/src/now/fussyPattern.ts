import type { BabyEvent, EventType } from '../db/models';
import type { TimeOfDayPatternDto, PredictionsDto } from '../sync/contract';
import {
  patternOfType,
  windowAround,
  type PatternSuggestion,
  type PatternSuggestionInput,
  type PatternWindow,
} from './bellyPattern';
import { pastLiveEvents, typeIdsForKey } from './eventFacts';

/*
 * The fussy pattern suggestion on Now (the evening "witching hour", docs/design/11-patterns.md
 * section 7): the same recurring time-of-day detector as belly pain, over `fussy` events. The
 * pattern comes from the server (cached for offline); whether today's window is handled is decided
 * from local events. Pure and language-free; never a diagnosis.
 */

export const FUSSY_KEY = 'fussy';

/** The well-formed fussy pattern of a predictions response, if any. */
export function fussyPattern(
  predictions: PredictionsDto | null | undefined,
): TimeOfDayPatternDto | null {
  return patternOfType(predictions, FUSSY_KEY);
}

/** A fussy spell (running or not) started from the suggestion time on, or one still running. */
export function isFussyHandled(
  window: PatternWindow,
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): boolean {
  const ids = typeIdsForKey(types, FUSSY_KEY);
  const from = window.showFrom.getTime();
  return pastLiveEvents(events, now).some(
    (event) => ids.has(event.typeId) && (Date.parse(event.startedAt) >= from || !event.endedAt),
  );
}

/**
 * The suggestion to show now, or `null`: no pattern, outside the suggestion time (window start
 * minus the lead until the window ends), already handled, or "Not today" for this window.
 */
export function fussySuggestion(input: PatternSuggestionInput): PatternSuggestion | null {
  const pattern = fussyPattern(input.predictions);
  if (!pattern) return null;
  const window = windowAround(pattern, input.now);
  if (!window || window.date === input.dismissedDate) return null;
  if (isFussyHandled(window, input.events, input.types, input.now)) return null;
  return { pattern, window };
}
