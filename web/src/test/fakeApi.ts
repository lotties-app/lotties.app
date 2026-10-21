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
    deletedAt: null,
  };
}

function defaultResponse(call: ApiCall): unknown {
  if (call.method === 'PUT') return echoEvent(call);
  if (call.method === 'DELETE') return undefined;
  if (call.path === '/api/v1/babies')
    return [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01' }];
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
