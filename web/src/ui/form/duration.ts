export type ParsedDuration =
  { kind: 'empty' } | { kind: 'ok'; seconds: number } | { kind: 'invalid' };

/**
 * Reads a duration typed in minutes: `12` (12 min), `12:30` (12 min 30 s, `mm:ss`), `1:02:03`
 * (`h:mm:ss`) and decimal minutes (`12,5` or `12.5`). Seconds are the stored unit.
 */
export function parseDuration(text: string): ParsedDuration {
  const value = text.trim();
  if (value === '') return { kind: 'empty' };
  if (/^\d+$/.test(value)) return { kind: 'ok', seconds: Number(value) * 60 };
  const clock = /^(\d+):([0-5]?\d)$/.exec(value);
  if (clock) return { kind: 'ok', seconds: Number(clock[1]) * 60 + Number(clock[2]) };
  const long = /^(\d+):([0-5]?\d):([0-5]?\d)$/.exec(value);
  if (long) {
    return { kind: 'ok', seconds: Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3]) };
  }
  const decimal = /^(\d+)[.,](\d+)$/.exec(value);
  if (decimal)
    return { kind: 'ok', seconds: Math.round(Number(`${decimal[1]}.${decimal[2]}`) * 60) };
  return { kind: 'invalid' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Seconds as the field shows them: `12` for whole minutes, `12:30` otherwise. */
export function formatDurationInput(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? String(minutes) : `${minutes}:${pad(rest)}`;
}
