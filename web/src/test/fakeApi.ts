import type { ApiClient, RequestOptions } from '../api/apiClient';
import { ApiError } from '../api/ApiError';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import type { EventDto, EventUpsertRequest } from '../sync/contract';

export interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
  /** Whether the caller opted out of the client's 401 login redirect. */
  skipUnauthorizedHandler?: boolean;
}

/** Returns a response body, throws to fail, or returns `undefined` to fall back to defaults. */
export type ApiHandler = (call: ApiCall) => unknown;

export const BABY_ID = 'baby-1';
export const TYPE_ID = 'type-feeding';
export const SERVER_TIME = '2026-10-20T12:00:00.000Z';

export function httpError(status: number, code?: string) {
  return new ApiError(status, { title: `status ${status}`, ...(code ? { code } : {}) });
}

export function networkError() {
  return new TypeError('Failed to fetch');
}

/** Echo of an upsert as the server would return it (server clock on `updatedAt`). */
export function echoEvent(call: ApiCall, updatedAt = SERVER_TIME): EventDto {
  const [, babyId, eventId] = /babies\/([^/]+)\/events\/([^/?]+)/.exec(call.path) ?? [];
  const body = call.body as EventUpsertRequest;
  return {
    id: decodeURIComponent(eventId),
    babyId: decodeURIComponent(babyId),
    ...body,
    createdBy: 'user-1',
    createdAt: updatedAt,
    updatedAt,
    clientUpdatedAt: body.updatedAt ?? updatedAt,
    deletedAt: null,
  };
}

function defaultResponse(call: ApiCall): unknown {
  if (call.method === 'PUT') return echoEvent(call);
  if (call.method === 'DELETE') return undefined;
  if (call.path === '/api/v1/babies')
    return [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' }];
  if (call.path.includes('/predictions')) {
    return { babyId: BABY_ID, generatedAt: SERVER_TIME, predictions: [], insufficientData: [] };
  }
  return [];
}

/** A handler result that also sets response headers (e.g. `X-Next-Cursor`). */
export class FakeResponse {
  readonly body: unknown;
  readonly headers: Headers;

  constructor(body: unknown, headers: Record<string, string> = {}) {
    this.body = body;
    this.headers = new Headers(headers);
  }
}

export function withHeaders(body: unknown, headers: Record<string, string>) {
  return new FakeResponse(body, headers);
}

/** Scripted in-memory API client that records every call. */
export function fakeApi(handler: ApiHandler = () => undefined) {
  const calls: ApiCall[] = [];

  async function requestWithMeta<T>(path: string, options: RequestOptions = {}) {
    const call: ApiCall = {
      method: options.method ?? 'GET',
      path,
      body: options.body,
      skipUnauthorizedHandler: options.skipUnauthorizedHandler ?? false,
    };
    calls.push(call);
    const result = await handler(call);
    const response = result instanceof FakeResponse ? result : new FakeResponse(result);
    const data = response.body === undefined ? defaultResponse(call) : response.body;
    return { data: data as T, status: 200, headers: response.headers };
  }

  const api: ApiClient = {
    requestWithMeta,
    request: async <T>(path: string, options?: RequestOptions) =>
      (await requestWithMeta<T>(path, options)).data,
  };
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { api, calls, writes };
}

export function serverEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'evt-remote',
    babyId: BABY_ID,
    typeId: TYPE_ID,
    startedAt: '2026-10-20T08:00:00.000Z',
    endedAt: null,
    payload: {},
    notes: null,
    createdBy: 'user-2',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: SERVER_TIME,
    deletedAt: null,
    ...overrides,
  };
}

/** A fresh, uniquely named IndexedDB (fake-indexeddb in tests). */
export function testDatabase(): BabyRoutineDb {
  return createDatabase(`test-${crypto.randomUUID()}`);
}

export interface FakeEventServerOptions {
  /** Server clock at the first request (UTC ISO). */
  start: string;
  /** Milliseconds the server clock moves per request. Default 1000. */
  stepMs?: number;
  /**
   * Last-write-wins rule for an upsert's `updatedAt`: `client` compares it with the stored
   * `clientUpdatedAt` (current API), `server` with the stored server `updatedAt` (the pre-fix API
   * that dropped offline edits).
   */
  compare?: 'client' | 'server';
}

/**
 * Stateful in-memory events API with its own moving clock, independent of the client clock:
 * PUT upserts (with the configured last-write-wins rule), DELETE soft-deletes, GET returns one
 * event or the `since` delta. Use `server.handler` as (part of) a `fakeApi` handler.
 */
export function fakeEventServer({
  start,
  stepMs = 1_000,
  compare = 'client',
}: FakeEventServerOptions) {
  const events = new Map<string, EventDto>();
  let clock = Date.parse(start);
  const tick = () => {
    const now = new Date(clock).toISOString();
    clock += stepMs;
    return now;
  };
  const idOf = (path: string) => /\/events\/([^/?]+)/.exec(path)?.[1];

  function put(id: string, call: ApiCall): EventDto {
    const now = tick();
    const body = call.body as EventUpsertRequest;
    const stored = events.get(id);
    if (stored?.deletedAt) return stored;
    const storedEdit = compare === 'client' ? stored?.clientUpdatedAt : stored?.updatedAt;
    if (stored && body.updatedAt && storedEdit && body.updatedAt < storedEdit) return stored;
    const next: EventDto = {
      ...echoEvent(call, now),
      createdBy: stored?.createdBy ?? 'user-1',
      createdAt: stored?.createdAt ?? now,
      clientUpdatedAt: body.updatedAt ?? now,
    };
    events.set(id, next);
    return next;
  }

  function handler(call: ApiCall): unknown {
    if (!call.path.includes('/events')) return undefined;
    const id = idOf(call.path);
    if (call.method === 'PUT' && id) return put(decodeURIComponent(id), call);
    if (call.method === 'DELETE' && id) {
      const stored = events.get(decodeURIComponent(id));
      const now = tick();
      if (stored && !stored.deletedAt) {
        events.set(stored.id, { ...stored, deletedAt: now, updatedAt: now });
      }
      return null;
    }
    if (id) {
      const stored = events.get(decodeURIComponent(id));
      if (!stored) throw httpError(404, 'event_not_found');
      return stored;
    }
    const since = new URL(call.path, 'http://x').searchParams.get('since');
    return [...events.values()]
      .filter((e) => !since || e.updatedAt >= since)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  return { events, handler, now: () => new Date(clock).toISOString() };
}
