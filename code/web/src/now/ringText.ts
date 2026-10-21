import type { TFunction } from 'i18next';
import { formatDuration, formatTime } from '../i18n/format';
import type { RingModel } from './ringGeometry';

const MINUTE_MS = 60_000;

/** Text of the ring for assistive technology: what the picture shows, in reading order. */
export function ringDescription(
  ring: RingModel,
  t: TFunction,
  now: Date,
  stateLabel: string,
  duration: string,
): string {
  const parts = [`${t('now.ring.title')}.`, `${stateLabel} ${duration}.`];
  parts.push(
    ring.sleptMinutes > 0
      ? t('now.ring.slept', { duration: formatDuration(ring.sleptMinutes * MINUTE_MS) })
      : t('now.ring.noSleep'),
  );
  for (const marker of ring.markers) {
    parts.push(
      t(marker.kind === 'wake' ? 'now.ring.wokeAt' : 'now.ring.bedAt', {
        time: formatTime(marker.at),
      }),
    );
  }
  parts.push(t('now.ring.nowAt', { time: formatTime(now) }));
  const seen = new Set<string>();
  for (const window of ring.windows) {
    if (seen.has(window.earliest)) continue;
    seen.add(window.earliest);
    parts.push(
      t('now.ring.windowAt', {
        from: formatTime(window.earliest),
        to: formatTime(window.latest),
      }),
    );
  }
  return parts.join(' ');
}
