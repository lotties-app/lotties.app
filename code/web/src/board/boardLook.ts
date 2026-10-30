import type { IconName } from '../ui/icons';
import type { BoardPriority, BoardStatus, BoardType } from './boardApi';

/** The icon of each item type (the type's name is always written next to it or read aloud). */
export const TYPE_ICONS: Record<BoardType, IconName> = {
  task: 'square-check',
  gap: 'puzzle',
  decision: 'flag',
  question: 'help',
  risk: 'warning',
  note: 'note',
  memory: 'bookmark',
};

/** MUI chip colour of a status: tone helps, the word carries the meaning. */
export const STATUS_COLORS: Record<
  BoardStatus,
  'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
> = {
  open: 'default',
  in_progress: 'info',
  blocked: 'error',
  waiting: 'warning',
  done: 'success',
  dropped: 'default',
};

/** Priorities that deserve a mark in a compact row (normal and low stay quiet). */
export const LOUD_PRIORITIES: readonly BoardPriority[] = ['high', 'urgent'];

/** Today as `yyyy-mm-dd` in UTC, the zone of the API's "overdue". */
export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
