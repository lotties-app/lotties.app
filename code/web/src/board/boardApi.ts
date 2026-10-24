import type { ApiClient } from '../api/apiClient';
import { ApiError } from '../api/ApiError';
import { API_PREFIX } from '../sync/contract';

/*
 * The project board's REST API (docs/design/36-project-board.md section 3): online only, nothing
 * is written to the device's database. Every call throws `ApiError` (or a network `TypeError`).
 * The board holds no baby data and no route here is baby-scoped.
 */

export const BOARD_TYPES = [
  'task',
  'gap',
  'decision',
  'question',
  'risk',
  'note',
  'memory',
] as const;
export type BoardType = (typeof BOARD_TYPES)[number];
export const BOARD_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'waiting',
  'done',
  'dropped',
] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_SIDES = ['owner', 'assistant', 'both', 'external'] as const;
export type BoardSide = (typeof BOARD_SIDES)[number];
export const BOARD_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type BoardPriority = (typeof BOARD_PRIORITIES)[number];
export const BOARD_SORTS = ['updated', 'created', 'priority', 'due', 'decided'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
export const CLOSED_STATUSES: readonly BoardStatus[] = ['done', 'dropped'];

/** `GET /board/me`: what the caller may do. */
export interface BoardMe {
  kind: 'user' | 'api_key';
  name: string;
  roles: string[];
  scope: string | null;
  keyId: string | null;
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  allowedTopics: string[] | null;
}

export interface BoardTopic {
  key: string;
  name: string;
  description: string | null;
  sortOrder: number;
  archived: boolean;
}

export interface BoardActor {
  kind: 'user' | 'api_key';
  name: string;
  keyId?: string | null;
}

export interface BoardLink {
  label: string;
  url: string;
}

export interface BoardDecision {
  summary: string | null;
  rationale: string | null;
  decidedAt: string | null;
}

interface BoardItemBase {
  id: string;
  type: BoardType;
  topic: string;
  title: string;
  status: BoardStatus;
  side: BoardSide;
  priority: BoardPriority;
  labels: string[];
  dueDate: string | null;
  links: BoardLink[];
  pinned: boolean;
  decision: BoardDecision | null;
  source: string | null;
  externalKey: string | null;
  createdBy: BoardActor;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  deletedAt: string | null;
  version: number;
}

/** An item in a list: no body, its first characters as `excerpt`. */
export interface BoardItemSummary extends BoardItemBase {
  excerpt: string | null;
}

export interface BoardItem extends BoardItemBase {
  body: string | null;
}

export interface BoardFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface BoardHistoryEvent {
  id: string;
  at: string;
  kind: 'created' | 'updated' | 'status_changed' | 'commented' | 'decided' | 'deleted' | 'restored';
  actor: BoardActor;
  changes: BoardFieldChange[];
  comment: string | null;
}

export interface BoardItemDetail {
  item: BoardItem;
  history: BoardHistoryEvent[];
}

export interface BoardItemPage {
  items: BoardItemSummary[];
  nextCursor: string | null;
}

export interface BoardTotals {
  open: number;
  waitingOnOwner: number;
  waitingOnAssistant: number;
  blocked: number;
  overdue: number;
}

export interface BoardCount {
  topic: string;
  side: BoardSide;
  status: BoardStatus;
  count: number;
}

export interface BoardSummary {
  generatedAt: string;
  totals: BoardTotals;
  counts: BoardCount[];
  waitingOnOwner: BoardItemSummary[];
  waitingOnAssistant: BoardItemSummary[];
  recentDecisions: BoardItemSummary[];
  recentlyUpdated: BoardItemSummary[];
}

/** The editable fields of an item, as sent by create and patch (`null` clears an optional one). */
export interface BoardItemFields {
  type: BoardType;
  topic: string;
  title: string;
  body: string | null;
  status: BoardStatus;
  side: BoardSide;
  priority: BoardPriority;
  labels: string[];
  dueDate: string | null;
  links: BoardLink[];
  pinned: boolean;
  decisionSummary: string | null;
  rationale: string | null;
  decidedAt: string | null;
  source: string | null;
}

export type BoardItemCreate = Partial<BoardItemFields> &
  Pick<BoardItemFields, 'type' | 'topic' | 'title'> & { id?: string };

export type BoardItemPatch = Partial<BoardItemFields>;

export interface BoardApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  allowedTopics: string[] | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  revokedAt: string | null;
  active: boolean;
}

export interface BoardApiKeyCreate {
  name: string;
  scope: 'read' | 'write';
  allowedTopics?: string[];
  expiresAt?: string;
}

/** The answer that creates a key: the secret is in it this one time only. */
export interface CreatedBoardApiKey {
  key: BoardApiKey;
  secret: string;
}

export interface BoardTopicUpsert {
  name: string;
  description?: string | null;
  sortOrder?: number;
  archived?: boolean;
}

/** The list filters of `GET /board/items` (section 3.2). Lists are "any of". */
export interface BoardListQuery {
  topic?: readonly string[];
  type?: readonly string[];
  status?: readonly string[];
  side?: readonly string[];
  priority?: readonly string[];
  label?: readonly string[];
  pinned?: boolean;
  open?: boolean;
  q?: string;
  includeDeleted?: boolean;
  sort?: BoardSort;
  limit?: number;
  cursor?: string | null;
}

export const BOARD_PREFIX = `${API_PREFIX}/board`;
const enc = encodeURIComponent;

export const boardPaths = {
  me: () => `${BOARD_PREFIX}/me`,
  topics: (includeArchived = false) =>
    `${BOARD_PREFIX}/topics${includeArchived ? '?includeArchived=true' : ''}`,
  topic: (key: string) => `${BOARD_PREFIX}/topics/${enc(key)}`,
  items: (query: string) => `${BOARD_PREFIX}/items${query ? `?${query}` : ''}`,
  item: (id: string) => `${BOARD_PREFIX}/items/${enc(id)}`,
  comments: (id: string) => `${BOARD_PREFIX}/items/${enc(id)}/comments`,
  restore: (id: string) => `${BOARD_PREFIX}/items/${enc(id)}/restore`,
  summary: () => `${BOARD_PREFIX}/summary`,
  keys: () => `${BOARD_PREFIX}/keys`,
  key: (id: string) => `${BOARD_PREFIX}/keys/${enc(id)}`,
};

/** The query string of a list request: lists comma-separated, empty values left out. */
export function listQueryString(query: BoardListQuery): string {
  const params = new URLSearchParams();
  const list = (name: string, values: readonly string[] | undefined) => {
    if (values && values.length > 0) params.set(name, values.join(','));
  };
  list('topic', query.topic);
  list('type', query.type);
  list('status', query.status);
  list('side', query.side);
  list('priority', query.priority);
  list('label', query.label);
  if (query.pinned !== undefined) params.set('pinned', String(query.pinned));
  if (query.open) params.set('open', 'true');
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.includeDeleted) params.set('includeDeleted', 'true');
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

/** Whether a value looks like the `/board/me` answer (a stray or empty body never grants access). */
function isMe(value: unknown): value is BoardMe {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as BoardMe).canRead === 'boolean'
  );
}

/**
 * The caller's board access, or `null` when there is none: the board is disabled (404), the user
 * has no board role (403), or the answer is not one. Never sends the user to sign in (a 401 is
 * "no access" here: the Hub must not navigate away for an optional entry).
 */
export async function fetchBoardMe(api: ApiClient, signal?: AbortSignal): Promise<BoardMe | null> {
  try {
    const me = await api.request<unknown>(boardPaths.me(), {
      signal,
      skipUnauthorizedHandler: true,
    });
    return isMe(me) && me.canRead ? me : null;
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return null;
    throw error;
  }
}

export function fetchTopics(api: ApiClient, includeArchived: boolean, signal?: AbortSignal) {
  return api.request<BoardTopic[]>(boardPaths.topics(includeArchived), { signal });
}

export function upsertTopic(api: ApiClient, key: string, body: BoardTopicUpsert) {
  return api.request<BoardTopic>(boardPaths.topic(key), { method: 'PUT', body });
}

export function fetchItems(api: ApiClient, query: BoardListQuery, signal?: AbortSignal) {
  return api.request<BoardItemPage>(boardPaths.items(listQueryString(query)), { signal });
}

export function fetchItem(api: ApiClient, id: string, signal?: AbortSignal) {
  return api.request<BoardItemDetail>(boardPaths.item(id), { signal });
}

export function createItem(api: ApiClient, body: BoardItemCreate) {
  return api.request<BoardItem>(`${BOARD_PREFIX}/items`, { method: 'POST', body });
}

/** A merge patch guarded by the item's version (`If-Match`): a stale one is 412. */
export function patchItem(api: ApiClient, id: string, version: number, body: BoardItemPatch) {
  return api.request<BoardItem>(boardPaths.item(id), {
    method: 'PATCH',
    body,
    headers: { 'If-Match': `"${version}"` },
  });
}

export function addComment(api: ApiClient, id: string, comment: string) {
  return api.request<BoardHistoryEvent>(boardPaths.comments(id), {
    method: 'POST',
    body: { comment },
  });
}

export async function deleteItem(api: ApiClient, id: string): Promise<void> {
  await api.request<unknown>(boardPaths.item(id), { method: 'DELETE' });
}

export function restoreItem(api: ApiClient, id: string) {
  return api.request<BoardItem>(boardPaths.restore(id), { method: 'POST' });
}

export function fetchSummary(api: ApiClient, signal?: AbortSignal) {
  return api.request<BoardSummary>(boardPaths.summary(), { signal });
}

export function fetchKeys(api: ApiClient, signal?: AbortSignal) {
  return api.request<BoardApiKey[]>(boardPaths.keys(), { signal });
}

export function createKey(api: ApiClient, body: BoardApiKeyCreate) {
  return api.request<CreatedBoardApiKey>(boardPaths.keys(), { method: 'POST', body });
}

export async function revokeKey(api: ApiClient, id: string): Promise<void> {
  await api.request<unknown>(boardPaths.key(id), { method: 'DELETE' });
}

/** The 412 of a stale write (`board_version_mismatch`). */
export const isVersionConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 412;
