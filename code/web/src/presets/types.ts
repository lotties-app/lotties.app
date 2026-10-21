import type { EventPayload } from '../db/models';
import type { CategoryName } from '../theme/tokens';

/**
 * What tapping a preset does:
 * - `timer`: starts a running event now;
 * - `instant`: logs a point-in-time event now (`endedAt = startedAt`);
 * - `sheet`: opens the event sheet prefilled (see `sheetPrefill`);
 * - `link`: not backed by an event type (the "Custom" tile opens Settings > Event types).
 */
export type PresetMode = 'timer' | 'instant' | 'sheet' | 'link';

/** A built-in preset as defined in code; `presetsForBaby` resolves it against the baby's types. */
export interface PresetDefinition {
  /** Stable id (persisted in the pinned list). */
  id: string;
  label: string;
  category: CategoryName;
  /** Preset icon name (see `presetIcons.ts`); custom types use their event type icon name. */
  icon: string;
  /** Built-in event type key (`sleep`, `feeding`, ...); empty for `link`. */
  typeKey: string;
  mode: PresetMode;
  /** Payload fields the preset sets (snake_case keys, as in the event type fields). */
  payloadDefaults: Readonly<EventPayload>;
  /** `sheet` presets log a zero-length event (`endedAt = startedAt`). */
  endsImmediately?: boolean;
  /** Also stops the running nap/night sleep timers, at the same moment. */
  stopsSleepTimers?: boolean;
  /** Also starts a sleep timer whose kind (nap/night) is inferred. */
  startsInferredSleepTimer?: boolean;
  /** Route opened by a `link` preset. */
  href?: string;
}

/** A preset resolved for one baby. */
export interface Preset extends PresetDefinition {
  /** The baby's event type id; `null` for `link` presets. */
  typeId: string | null;
  builtIn: boolean;
  /** Event type colour of a custom preset (validated hex), if any. */
  customColor?: string;
}

export const MAX_PINNED = 4;
