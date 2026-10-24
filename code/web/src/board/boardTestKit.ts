import { httpError, type ApiCall } from '../test/fakeApi';
import { ApiError } from '../api/ApiError';
import { DUE_SOON_DAYS } from './boardQuery';
import {
  BOARD_PREFIX,
  BOARD_PRIORITIES,
  CLOSED_STATUSES,
  type BoardApiKey,
  type BoardHistoryEvent,
  type BoardItem,
  type BoardItemSummary,
  type BoardMe,
  type BoardSummary,
  type BoardTopic,
} from './boardApi';

/*
 * An in-memory board API for tests and the developer preview (`/dev/board`): the routes of
 * docs/design/36-project-board.md section 3 with their filters, cursor pages, versions (412 on a
 * stale If-Match), soft delete, restore, history and API keys. Synthetic project items only.
 */

export const BOARD_NOW = Date.parse('2026-10-24T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;

export const ROLE_ME: Record<'reader' | 'writer' | 'admin', BoardMe> = {
  reader: me('reader', false, false),
  writer: me('writer', true, false),
  admin: me('admin', true, true),
};

function me(role: string, canWrite: boolean, canAdmin: boolean): BoardMe {
  return {
    kind: 'user',
    name: 'Vini',
    roles: [`lotties-board-${role}`],
    scope: null,
    keyId: null,
    canRead: true,
    canWrite,
    canAdmin,
    allowedTopics: null,
  };
}

const TOPIC_NAMES: [string, string][] = [
  ['product', 'Product'],
  ['doctor-access', 'Doctor access'],
  ['assistants-alexa-mcp', 'Assistants, Alexa and MCP'],
  ['privacy-legal', 'Privacy and legal'],
  ['mobile-stores', 'Mobile stores'],
  ['infrastructure-deploy', 'Infrastructure and deploy'],
  ['data-catalog', 'Data catalog'],
  ['predictions-ml', 'Predictions and ML'],
  ['design-ux', 'Design and UX'],
  ['process-meta', 'Process'],
];

export function boardTopics(): BoardTopic[] {
  return TOPIC_NAMES.map(([key, name], index) => ({
    key,
    name,
    description: null,
    sortOrder: (index + 1) * 10,
    archived: false,
  }));
}

const iso = (ms: number) => new Date(ms).toISOString();

export function boardItem(
  overrides: Partial<BoardItem> & { id: string; title: string },
): BoardItem {
  const updatedAt = overrides.updatedAt ?? iso(BOARD_NOW - 2 * 60 * MINUTE);
  return {
    type: 'task',
    topic: 'product',
    body: null,
    status: 'open',
    side: 'both',
    priority: 'normal',
    labels: [],
    dueDate: null,
    links: [],
    pinned: false,
    decision: null,
    source: null,
    externalKey: null,
    createdBy: { kind: 'user', name: 'Vini' },
    createdAt: overrides.createdAt ?? updatedAt,
    updatedAt,
    closedAt: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

/** A small board: tasks on both sides, a blocked one, gaps, decisions, notes and memories. */
export function sampleItems(): BoardItem[] {
  const ago = (days: number) => iso(BOARD_NOW - days * DAY);
  return [
    boardItem({
      id: '11111111-0000-4000-8000-000000000001',
      title: 'Turn the board on in the home lab',
      topic: 'infrastructure-deploy',
      side: 'owner',
      priority: 'high',
      dueDate: '2026-10-20',
      labels: ['deploy', 'config'],
      body: '## Steps\n\n1. Add `Board__Enabled` to the API values\n2. Apply the migration\n3. Check `/api/v1/board/me`\n\nSee [the guide](https://github.com/dev-vinicius-andrade/baby-routine).',
      source: 'docs/KEYCLOAK-BOARD.md',
      updatedAt: ago(1),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000002',
      title: 'Write the import script for docs/agents/PLAN.md',
      topic: 'process-meta',
      side: 'assistant',
      status: 'in_progress',
      priority: 'urgent',
      labels: ['seed'],
      updatedAt: ago(0.1),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000003',
      title: 'Store listing screenshots need the new icon',
      topic: 'mobile-stores',
      side: 'external',
      status: 'blocked',
      updatedAt: ago(3),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000004',
      title: 'No due-date filter in the list API',
      type: 'gap',
      topic: 'product',
      side: 'assistant',
      priority: 'high',
      updatedAt: ago(2),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000005',
      title: 'Retention of soft-deleted board items',
      type: 'gap',
      topic: 'privacy-legal',
      side: 'owner',
      priority: 'normal',
      updatedAt: ago(5),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000006',
      title: 'The board stays off by default',
      type: 'decision',
      topic: 'process-meta',
      status: 'done',
      decision: {
        summary: 'Board__Enabled is false until the owner turns it on.',
        rationale:
          'Nothing is exposed by a deploy alone; the owner decides when the routes answer.',
        decidedAt: ago(4),
      },
      closedAt: ago(4),
      updatedAt: ago(4),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000007',
      title: 'Keys are hashed, never stored',
      type: 'decision',
      topic: 'privacy-legal',
      status: 'done',
      decision: {
        summary: 'Only the SHA-256 and the 12-character prefix are kept.',
        rationale: null,
        decidedAt: ago(1.5),
      },
      closedAt: ago(1.5),
      updatedAt: ago(1.5),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000008',
      title: 'Deploy order',
      type: 'memory',
      topic: 'infrastructure-deploy',
      pinned: true,
      labels: ['deploy'],
      body: 'Back up, **apply migrations first**, then deploy the API and the web.',
      updatedAt: ago(6),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000009',
      title: 'Ideas for the summary strip',
      type: 'note',
      topic: 'design-ux',
      labels: ['ui', 'ideas'],
      body: '- Waiting on you\n- Waiting on the assistant\n- *Due soon* needs an API filter',
      updatedAt: ago(0.5),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000010',
      title: 'Which topics may the assistant key write?',
      type: 'question',
      topic: 'assistants-alexa-mcp',
      side: 'owner',
      updatedAt: ago(0.3),
    }),
    boardItem({
      id: '11111111-0000-4000-8000-000000000011',
      title: 'Translate the install guide screenshots',
      topic: 'design-ux',
      status: 'done',
      closedAt: ago(8),
      updatedAt: ago(8),
    }),
  ];
}

export function sampleHistory(item: BoardItem): BoardHistoryEvent[] {
  const created: BoardHistoryEvent = {
    id: `${item.id}-h1`,
    at: item.createdAt,
    kind: 'created',
    actor: item.createdBy,
    changes: [],
    comment: null,
  };
  return [created];
}

export function sampleKeys(): BoardApiKey[] {
  return [
    {
      id: '22222222-0000-4000-8000-000000000001',
      name: 'Claude Code (dev machine)',
      prefix: 'lbk_AbCdEfGh',
      scope: 'write',
      allowedTopics: null,
      createdBy: 'Vini',
      createdAt: iso(BOARD_NOW - 10 * DAY),
      expiresAt: iso(BOARD_NOW + 170 * DAY),
      lastUsedAt: iso(BOARD_NOW - 20 * MINUTE),
      useCount: 42,
      revokedAt: null,
      active: true,
    },
    {
      id: '22222222-0000-4000-8000-000000000002',
      name: 'Old script',
      prefix: 'lbk_ZyXwVuTs',
      scope: 'read',
      allowedTopics: ['process-meta'],
      createdBy: 'Vini',
      createdAt: iso(BOARD_NOW - 60 * DAY),
      expiresAt: null,
      lastUsedAt: null,
      useCount: 0,
      revokedAt: iso(BOARD_NOW - 30 * DAY),
      active: false,
    },
  ];
}

export const NEW_SECRET = 'lbk_TESTSECRETabcdefghijklmnopqrstuvwxyz012345678';

export type BoardAccessMode = BoardMe | 'disabled' | 'forbidden';

export interface FakeBoardOptions {
  access?: BoardAccessMode;
  items?: BoardItem[];
  topics?: BoardTopic[];
  keys?: BoardApiKey[];
  /** Answer every list with this error (offline-like failures). */
  failList?: Error;
}

function summaryOf(item: BoardItem): BoardItemSummary {
  const { body, ...rest } = item;
  return { ...rest, excerpt: body ? body.slice(0, 200) : null };
}

const PRIORITY_RANK = Object.fromEntries(
  [...BOARD_PRIORITIES].reverse().map((priority, index) => [priority, index]),
);

/** The scripted board server; `handler` plugs into `fakeApi`. */
export function fakeBoardServer(options: FakeBoardOptions = {}) {
  let access: BoardAccessMode = options.access ?? ROLE_ME.admin;
  const topics = options.topics ?? boardTopics();
  const items = new Map((options.items ?? sampleItems()).map((item) => [item.id, item]));
  const history = new Map([...items.values()].map((item) => [item.id, sampleHistory(item)]));
  const keys = options.keys ?? sampleKeys();
  let clock = BOARD_NOW;
  const tick = () => iso((clock += MINUTE));
  const isAdmin = () => typeof access === 'object' && access.canAdmin;

  const record = (item: BoardItem, entry: Omit<BoardHistoryEvent, 'id' | 'at' | 'actor'>) => {
    const list = history.get(item.id) ?? [];
    list.push({
      id: `${item.id}-h${list.length + 1}`,
      at: item.updatedAt,
      actor: { kind: 'user', name: 'Vini' },
      ...entry,
    });
    history.set(item.id, list);
  };

  function list(url: URL) {
    const all = (name: string) =>
      url.searchParams
        .getAll(name)
        .flatMap((value) => value.split(','))
        .filter(Boolean);
    const anyOf = (name: string, value: string) => {
      const wanted = all(name);
      return wanted.length === 0 || wanted.includes(value);
    };
    const q = url.searchParams.get('q')?.toLowerCase();
    const open = url.searchParams.get('open') === 'true';
    const deleted = url.searchParams.get('includeDeleted') === 'true';
    if (deleted && !isAdmin()) throw httpError(403, 'board_admin_required');
    const labels = all('label');
    const dueAfter = url.searchParams.get('dueAfter');
    const dueBefore = url.searchParams.get('dueBefore');
    const hasDue = url.searchParams.get('hasDue');
    const dueMatches = (due: string | null) =>
      (!dueAfter || (!!due && due >= dueAfter)) &&
      (!dueBefore || (!!due && due <= dueBefore)) &&
      (hasDue === null || (hasDue === 'true') === !!due);
    const sort = url.searchParams.get('sort') ?? 'updated';
    let found = [...items.values()].filter(
      (item) =>
        (deleted || !item.deletedAt) &&
        anyOf('topic', item.topic) &&
        anyOf('type', item.type) &&
        anyOf('status', item.status) &&
        anyOf('side', item.side) &&
        anyOf('priority', item.priority) &&
        (labels.length === 0 || labels.some((label) => item.labels.includes(label))) &&
        (!open || !CLOSED_STATUSES.includes(item.status)) &&
        dueMatches(item.dueDate) &&
        (!q || item.title.toLowerCase().includes(q) || (item.body ?? '').toLowerCase().includes(q)),
    );
    const newest = (a: BoardItem, b: BoardItem) => b.updatedAt.localeCompare(a.updatedAt);
    found = found.sort((a, b) => {
      if (sort === 'priority')
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || newest(a, b);
      if (sort === 'due')
        return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || newest(a, b);
      if (sort === 'decided')
        return (b.decision?.decidedAt ?? '').localeCompare(a.decision?.decidedAt ?? '');
      if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
      return newest(a, b);
    });
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    const page = found.slice(offset, offset + limit);
    return {
      items: page.map(summaryOf),
      nextCursor: offset + limit < found.length ? String(offset + limit) : null,
    };
  }

  function summary(): BoardSummary {
    const live = [...items.values()].filter((item) => !item.deletedAt);
    const open = live.filter((item) => !CLOSED_STATUSES.includes(item.status));
    const counts = new Map<
      string,
      { topic: string; side: string; status: string; count: number }
    >();
    for (const item of live) {
      const key = `${item.topic}|${item.side}|${item.status}`;
      const entry = counts.get(key) ?? {
        topic: item.topic,
        side: item.side,
        status: item.status,
        count: 0,
      };
      entry.count++;
      counts.set(key, entry);
    }
    const onOwner = open.filter((item) => item.side === 'owner' || item.side === 'both');
    const onAssistant = open.filter((item) => item.side === 'assistant' || item.side === 'both');
    const actionable = (item: BoardItem) => item.status !== 'blocked';
    const today = iso(BOARD_NOW).slice(0, 10);
    const soon = iso(BOARD_NOW + DUE_SOON_DAYS * DAY).slice(0, 10);
    const blocked = open.filter((item) => item.status === 'blocked');
    const dueSoon = open.filter(
      (item) => item.dueDate && item.dueDate >= today && item.dueDate <= soon,
    );
    const overdue = open.filter((item) => item.dueDate && item.dueDate < today);
    return {
      generatedAt: iso(BOARD_NOW),
      totals: {
        open: open.length,
        waitingOnOwner: onOwner.length,
        waitingOnAssistant: onAssistant.length,
        blocked: blocked.length,
        overdue: overdue.length,
        actionableOwner: onOwner.filter(actionable).length,
        actionableAssistant: onAssistant.filter(actionable).length,
        dueSoon: dueSoon.length,
      },
      counts: [...counts.values()] as BoardSummary['counts'],
      waitingOnOwner: onOwner.filter(actionable).map(summaryOf),
      waitingOnAssistant: onAssistant.filter(actionable).map(summaryOf),
      recentDecisions: live.filter((item) => item.type === 'decision').map(summaryOf),
      recentlyUpdated: live.map(summaryOf),
      blocked: blocked.map(summaryOf),
      dueSoon: dueSoon.map(summaryOf),
      overdue: overdue.map(summaryOf),
    };
  }

  function stored(id: string): BoardItem {
    const item = items.get(id);
    if (!item || (item.deletedAt && !isAdmin())) throw httpError(404, 'board_item_not_found');
    return item;
  }

  function patch(id: string, call: ApiCall) {
    const item = stored(id);
    if (item.deletedAt) throw httpError(409, 'board_item_deleted');
    const expected = call.headers?.['If-Match']?.replace(/"/g, '');
    if (expected && Number(expected) !== item.version) {
      throw new ApiError(412, {
        status: 412,
        code: 'board_version_mismatch',
        currentVersion: item.version,
      });
    }
    const body = call.body as Record<string, unknown>;
    const next: BoardItem = { ...item, version: item.version + 1, updatedAt: tick() };
    const changes: BoardHistoryEvent['changes'] = [];
    for (const [field, value] of Object.entries(body)) {
      if (field === 'decisionSummary' || field === 'rationale' || field === 'decidedAt') {
        const decision = next.decision ?? { summary: null, rationale: null, decidedAt: null };
        const key = field === 'decisionSummary' ? 'summary' : field;
        next.decision = { ...decision, [key]: value as string | null };
      } else {
        (next as unknown as Record<string, unknown>)[field] = value;
      }
      const before = (item as unknown as Record<string, unknown>)[field];
      changes.push({
        field,
        from: before === undefined || before === null ? null : String(before),
        to: value === null ? null : String(value),
      });
    }
    if (body.status && CLOSED_STATUSES.includes(next.status)) next.closedAt = next.updatedAt;
    items.set(id, next);
    record(next, {
      kind: body.status && body.status !== item.status ? 'status_changed' : 'updated',
      changes,
      comment: null,
    });
    return next;
  }

  function handler(call: ApiCall): unknown {
    if (!call.path.startsWith(BOARD_PREFIX)) return undefined;
    const url = new URL(call.path, 'http://board.test');
    const path = url.pathname.slice(BOARD_PREFIX.length);
    if (access === 'disabled') throw httpError(404);
    if (access === 'forbidden') throw httpError(403);
    const itemMatch = /^\/items\/([^/]+)(\/comments|\/restore)?$/.exec(path);
    const keyMatch = /^\/keys\/([^/]+)$/.exec(path);
    const topicMatch = /^\/topics\/([^/]+)$/.exec(path);

    if (path === '/me') return access;
    if (path === '/topics' && call.method === 'GET') {
      return url.searchParams.get('includeArchived') === 'true'
        ? topics
        : topics.filter((topic) => !topic.archived);
    }
    if (topicMatch && call.method === 'PUT') {
      const key = decodeURIComponent(topicMatch[1]);
      const body = call.body as Partial<BoardTopic>;
      const existing = topics.find((topic) => topic.key === key);
      const next: BoardTopic = {
        key,
        name: body.name ?? existing?.name ?? key,
        description: body.description ?? null,
        sortOrder: body.sortOrder ?? existing?.sortOrder ?? 0,
        archived: body.archived ?? false,
      };
      if (existing) Object.assign(existing, next);
      else topics.push(next);
      return next;
    }
    if (path === '/items' && call.method === 'GET') {
      if (options.failList) throw options.failList;
      return list(url);
    }
    if (path === '/items' && call.method === 'POST') {
      const body = call.body as Partial<BoardItem> & { id: string; title: string };
      const at = tick();
      const item = boardItem({ ...body, createdAt: at, updatedAt: at });
      items.set(item.id, item);
      record(item, { kind: 'created', changes: [], comment: null });
      return item;
    }
    if (path === '/summary') return summary();
    if (path === '/keys' && call.method === 'GET') return keys;
    if (path === '/keys' && call.method === 'POST') {
      const body = call.body as {
        name: string;
        scope: 'read' | 'write';
        allowedTopics?: string[];
        expiresAt?: string;
      };
      const key: BoardApiKey = {
        id: `22222222-0000-4000-8000-${String(keys.length + 1).padStart(12, '0')}`,
        name: body.name,
        prefix: NEW_SECRET.slice(0, 12),
        scope: body.scope,
        allowedTopics: body.allowedTopics ?? null,
        createdBy: 'Vini',
        createdAt: tick(),
        expiresAt: body.expiresAt ?? null,
        lastUsedAt: null,
        useCount: 0,
        revokedAt: null,
        active: true,
      };
      keys.unshift(key);
      return { key, secret: NEW_SECRET };
    }
    if (keyMatch && call.method === 'DELETE') {
      const key = keys.find((candidate) => candidate.id === decodeURIComponent(keyMatch[1]));
      if (!key) throw httpError(404, 'board_api_key_not_found');
      key.revokedAt ??= tick();
      key.active = false;
      return null;
    }
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      if (itemMatch[2] === '/comments') {
        const item = stored(id);
        const next = { ...item, version: item.version + 1, updatedAt: tick() };
        items.set(id, next);
        const comment = (call.body as { comment: string }).comment;
        record(next, { kind: 'commented', changes: [], comment });
        return history.get(id)!.at(-1);
      }
      if (itemMatch[2] === '/restore') {
        if (!isAdmin()) throw httpError(403);
        const item = stored(id);
        const next = { ...item, deletedAt: null, version: item.version + 1, updatedAt: tick() };
        items.set(id, next);
        record(next, { kind: 'restored', changes: [], comment: null });
        return next;
      }
      if (call.method === 'GET') {
        const item = stored(id);
        return { item, history: history.get(id) ?? [] };
      }
      if (call.method === 'PATCH') return patch(id, call);
      if (call.method === 'DELETE') {
        const item = stored(id);
        if (!item.deletedAt) {
          const next = { ...item, deletedAt: tick(), version: item.version + 1 };
          items.set(id, next);
          record(next, { kind: 'deleted', changes: [], comment: null });
        }
        return null;
      }
    }
    throw httpError(404);
  }

  return {
    handler,
    items,
    keys,
    topics,
    setAccess: (next: BoardAccessMode) => {
      access = next;
    },
    /** Someone else edits an item (its version moves on): the next stale write is a 412. */
    touch: (id: string) => {
      const item = items.get(id)!;
      items.set(id, { ...item, version: item.version + 1, title: `${item.title} (edited)` });
    },
  };
}
