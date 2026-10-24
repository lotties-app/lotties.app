import {
  BOARD_PRIORITIES,
  BOARD_SIDES,
  BOARD_SORTS,
  BOARD_STATUSES,
  BOARD_TYPES,
  type BoardListQuery,
  type BoardPriority,
  type BoardSide,
  type BoardSort,
  type BoardStatus,
  type BoardTopic,
  type BoardType,
} from './boardApi';

/*
 * The board page's state as it lives in the URL (views and filters, so a link reopens the same
 * list) and its translation into the API's list query (docs/design/36-project-board.md section 10).
 * Pure: no React, no I/O.
 */

export const BOARD_VIEWS = ['topics', 'mine', 'assistant', 'decisions', 'gaps', 'notes'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

/** The admin settings dialog's tabs (`?panel=`). */
export const ADMIN_PANELS = ['keys', 'topics'] as const;
export type AdminPanel = (typeof ADMIN_PANELS)[number];

interface ViewDefinition {
  /** The types the view lists; the type filter offers only these (all types when absent). */
  types?: readonly BoardType[];
  /** The side the view is about; the side filter is not offered then. */
  sides?: readonly BoardSide[];
  sort: BoardSort;
  /** Whether "Hide done and dropped" applies (decisions are done once recorded, notes have no end). */
  hidesClosed: boolean;
}

export const VIEW_DEFINITIONS: Record<BoardView, ViewDefinition> = {
  topics: { sort: 'updated', hidesClosed: true },
  mine: { sides: ['owner'], sort: 'priority', hidesClosed: true },
  assistant: { sides: ['assistant'], sort: 'priority', hidesClosed: true },
  decisions: { types: ['decision'], sort: 'decided', hidesClosed: false },
  gaps: { types: ['gap'], sort: 'priority', hidesClosed: true },
  notes: { types: ['note', 'memory'], sort: 'updated', hidesClosed: false },
};

export interface BoardFilters {
  view: BoardView;
  q: string;
  type: BoardType[];
  status: BoardStatus[];
  side: BoardSide[];
  priority: BoardPriority[];
  label: string[];
  topic: string[];
  /** Leave out done and dropped items (on by default). */
  hideClosed: boolean;
  /** Admins: list deleted items too. */
  deleted: boolean;
  /** `null`: the view's own order. */
  sort: BoardSort | null;
}

export const DEFAULT_FILTERS: BoardFilters = {
  view: 'topics',
  q: '',
  type: [],
  status: [],
  side: [],
  priority: [],
  label: [],
  topic: [],
  hideClosed: true,
  deleted: false,
  sort: null,
};

export const LABEL_PATTERN = /^[a-z0-9._:/-]{1,40}$/;
export const TOPIC_KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
/** The URL parameters this model owns; any other one (the item drawer, a panel) is kept as is. */
const OWN_PARAMS = [
  'view',
  'q',
  'type',
  'status',
  'side',
  'priority',
  'label',
  'topic',
  'closed',
  'deleted',
  'sort',
];

function oneOf<T extends string>(all: readonly T[], value: string | null): T | null {
  return value !== null && (all as readonly string[]).includes(value) ? (value as T) : null;
}

/** A comma list of known codes only, without duplicates, in the canonical order. */
function codes<T extends string>(all: readonly T[], raw: string | null): T[] {
  if (!raw) return [];
  const given = new Set(raw.split(','));
  return all.filter((code) => given.has(code));
}

function freeList(raw: string | null, pattern: RegExp): string[] {
  if (!raw) return [];
  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => pattern.test(value));
  return [...new Set(values)].slice(0, 10);
}

/** Reads the board state from the URL; unknown or malformed values are ignored. */
export function parseFilters(params: URLSearchParams): BoardFilters {
  return {
    view: oneOf(BOARD_VIEWS, params.get('view')) ?? 'topics',
    q: (params.get('q') ?? '').slice(0, 200),
    type: codes(BOARD_TYPES, params.get('type')),
    status: codes(BOARD_STATUSES, params.get('status')),
    side: codes(BOARD_SIDES, params.get('side')),
    priority: codes(BOARD_PRIORITIES, params.get('priority')),
    label: freeList(params.get('label'), LABEL_PATTERN),
    topic: freeList(params.get('topic'), TOPIC_KEY_PATTERN),
    hideClosed: params.get('closed') !== 'show',
    deleted: params.get('deleted') === '1',
    sort: oneOf(BOARD_SORTS, params.get('sort')),
  };
}

/** Writes the board state into `base` (other parameters kept); defaults are left out. */
export function writeFilters(filters: BoardFilters, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const name of OWN_PARAMS) params.delete(name);
  if (filters.view !== 'topics') params.set('view', filters.view);
  if (filters.q.trim()) params.set('q', filters.q);
  const list = (name: string, values: readonly string[]) => {
    if (values.length > 0) params.set(name, values.join(','));
  };
  list('type', filters.type);
  list('status', filters.status);
  list('side', filters.side);
  list('priority', filters.priority);
  list('label', filters.label);
  list('topic', filters.topic);
  if (!filters.hideClosed) params.set('closed', 'show');
  if (filters.deleted) params.set('deleted', '1');
  if (filters.sort) params.set('sort', filters.sort);
  return params;
}

/** The types the type filter offers in a view. */
export const typesOf = (view: BoardView): readonly BoardType[] =>
  VIEW_DEFINITIONS[view].types ?? BOARD_TYPES;

/** Whether the view lets the person choose the side (Mine and Claude are a side). */
export const sideIsFree = (view: BoardView) => !VIEW_DEFINITIONS[view].sides;

/** Whether "Hide done and dropped" applies in the view. */
export const hidesClosed = (view: BoardView) => VIEW_DEFINITIONS[view].hidesClosed;

/**
 * The API list query of the board state: the view's fixed type and side, the person's filters
 * (types only those the view lists), `open` while done and dropped are hidden, and the order.
 */
export function listQuery(filters: BoardFilters, canAdmin: boolean): BoardListQuery {
  const view = VIEW_DEFINITIONS[filters.view];
  const allowed = typesOf(filters.view);
  const chosenTypes = filters.type.filter((type) => allowed.includes(type));
  const type = chosenTypes.length > 0 ? chosenTypes : view.types ? [...view.types] : [];
  const side = view.sides ? [...view.sides] : filters.side;
  return {
    type,
    side,
    status: filters.status,
    priority: filters.priority,
    label: filters.label,
    topic: filters.topic,
    q: filters.q.trim() || undefined,
    open: view.hidesClosed && filters.hideClosed ? true : undefined,
    includeDeleted: canAdmin && filters.deleted ? true : undefined,
    sort: filters.sort ?? view.sort,
  };
}

/** How many filters (beyond the view) are set: the filter button says so. */
export function activeFilterCount(filters: BoardFilters): number {
  const allowed = typesOf(filters.view);
  return (
    (allowed.length > 1 ? filters.type.filter((type) => allowed.includes(type)).length : 0) +
    filters.status.length +
    (sideIsFree(filters.view) ? filters.side.length : 0) +
    filters.priority.length +
    filters.label.length +
    filters.topic.length +
    (filters.sort ? 1 : 0)
  );
}

/** The four totals of the summary strip and the filter each one applies. */
export const SUMMARY_SHORTCUTS = [
  'waitingOnOwner',
  'waitingOnAssistant',
  'blocked',
  'overdue',
] as const;
export type SummaryShortcut = (typeof SUMMARY_SHORTCUTS)[number];

export function shortcutFilters(shortcut: SummaryShortcut): BoardFilters {
  switch (shortcut) {
    case 'waitingOnOwner':
      return { ...DEFAULT_FILTERS, side: ['owner', 'both'] };
    case 'waitingOnAssistant':
      return { ...DEFAULT_FILTERS, side: ['assistant', 'both'] };
    case 'blocked':
      return { ...DEFAULT_FILTERS, status: ['blocked'] };
    case 'overdue':
      // The list API has no due-date filter: open items, earliest due date first.
      return { ...DEFAULT_FILTERS, sort: 'due' };
  }
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Whether the board shows exactly what a summary shortcut applies (its chip is pressed). */
export function isShortcutActive(shortcut: SummaryShortcut, filters: BoardFilters): boolean {
  const target = shortcutFilters(shortcut);
  return (
    filters.view === target.view &&
    filters.q === target.q &&
    sameList(filters.type, target.type) &&
    sameList(filters.status, target.status) &&
    sameList(filters.side, target.side) &&
    sameList(filters.priority, target.priority) &&
    sameList(filters.label, target.label) &&
    sameList(filters.topic, target.topic) &&
    filters.hideClosed === target.hideClosed &&
    filters.sort === target.sort
  );
}

export interface QuickAddDefaults {
  type: BoardType;
  side: BoardSide;
  topic: string | null;
}

/**
 * What a one-line add creates in the current view: its type (or the one type filtered on), its
 * side (or the one side filtered on), and the one topic filtered on, else the last one used, else
 * the first open topic.
 */
export function quickAddDefaults(
  filters: BoardFilters,
  topics: readonly BoardTopic[],
  lastTopic: string | null,
): QuickAddDefaults {
  const view = VIEW_DEFINITIONS[filters.view];
  const types = filters.type.filter((type) => typesOf(filters.view).includes(type));
  const type: BoardType = types.length === 1 ? types[0] : view.types ? view.types[0] : 'task';
  const side: BoardSide = view.sides
    ? view.sides[0]
    : filters.side.length === 1
      ? filters.side[0]
      : 'both';
  const open = topics.filter((topic) => !topic.archived);
  const known = (key: string | null | undefined) =>
    key && open.some((topic) => topic.key === key) ? key : null;
  const topic =
    (filters.topic.length === 1 ? known(filters.topic[0]) : null) ??
    known(lastTopic) ??
    sortTopics(open)[0]?.key ??
    null;
  return { type, side, topic };
}

/** Topics in display order. */
export function sortTopics<T extends BoardTopic>(topics: readonly T[]): T[] {
  return [...topics].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}
