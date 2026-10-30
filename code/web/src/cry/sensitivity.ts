import { DEFAULT_CRY_TRIGGER, type CryTriggerConfig } from './trigger';

/**
 * Sensitivity levels of the cry monitor (docs/design/35-cry-engine.md section 3). Like the spike (docs/design/31
 * section 4.2), a level moves the threshold only; smoothing, N = 20 s of M = 60 s and Q = 3 min stay. Every level is
 * inside the spike's safe band 0.005-0.03 (false alarms appear at 0.005 on the test days, in-room detection drops
 * below 95 % above 0.03), so the spike's own "high" (0.002) and "low" (0.05) are not offered.
 */
export type CrySensitivity = 'less' | 'balanced' | 'more';

export const CRY_SAFE_BAND = Object.freeze({ min: 0.005, max: 0.03 });

export const CRY_SENSITIVITY_THRESHOLDS: Readonly<Record<CrySensitivity, number>> = Object.freeze({
  /** Top of the band: validation in-room detection 96.2 %, no false alarm on any validation or test day. */
  less: 0.03,
  /** The spike's standard default: in-room 99.2 % (test), 0 false alarms in 216 test days. */
  balanced: 0.02,
  /** Test days: 0 household and 0.04 stress-day false alarms a day; 0.005 already gave 0.44 a day. */
  more: 0.01,
});

export const DEFAULT_CRY_SENSITIVITY: CrySensitivity = 'balanced';

/** The trigger rule for a level; `overrides` are for tests and the bench, never for the monitor's settings. */
export function cryTriggerConfig(
  sensitivity: CrySensitivity = DEFAULT_CRY_SENSITIVITY,
  overrides: Partial<CryTriggerConfig> = {},
): CryTriggerConfig {
  return {
    ...DEFAULT_CRY_TRIGGER,
    threshold: CRY_SENSITIVITY_THRESHOLDS[sensitivity],
    ...overrides,
  };
}
