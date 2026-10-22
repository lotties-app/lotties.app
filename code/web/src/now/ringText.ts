import type { TFunction } from 'i18next';
import { formatDuration, formatTime } from '../i18n/format';
import type { RingModel, RingWindow } from './ringGeometry';

const MINUTE_MS = 60_000;

/** The first predicted window still ahead or open, once per prediction. */
function firstWindow(ring: RingModel): RingWindow | undefined {
  return ring.windows[0];
}

const isAhead = (window: RingWindow, now: Date) => Date.parse(window.earliest) > now.getTime();

/**
 * The line under the ring that says when the next nap window is ("Next nap about 11:20–12:11") or
 * that it is open now; `null` without a window. The times are never drawn on the ring itself.
 */
export function ringWindowLine(ring: RingModel, t: TFunction, now: Date): string | null {
  const window = firstWindow(ring);
  if (!window) return null;
  return isAhead(window, now)
    ? t('now.ring.nextWindow', {
        from: formatTime(window.earliest),
        to: formatTime(window.latest),
      })
    : t('now.ring.windowOpen', { to: formatTime(window.latest) });
}

/** Text of the ring for assistive technology: what the picture shows, in reading order. */
export function ringDescription(
  ring: RingModel,
  t: TFunction,
  now: Date,
  stateLabel: string,
  duration: string,
): string {
  const parts = [`${t('now.ring.title')}.`, `${stateLabel} ${duration}.`];
  const window = firstWindow(ring);
  if (window) {
    parts.push(
      t(isAhead(window, now) ? 'now.ring.nextWindowAt' : 'now.ring.windowAt', {
        from: formatTime(window.earliest),
        to: formatTime(window.latest),
      }),
    );
  }
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
  return parts.join(' ');
}
