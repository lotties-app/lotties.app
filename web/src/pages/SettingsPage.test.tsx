import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { BABY_ID, fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { SettingsPage } from './SettingsPage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const BASE = `/api/v1/babies/${BABY_ID}`;
const JOINED = '2026-10-01T10:00:00.000Z';

const MEMBERS = [
  { userId: 'u1', displayName: 'Ana', role: 'Owner', joinedAt: JOINED },
  { userId: 'u2', displayName: 'Bia', role: 'Viewer', joinedAt: JOINED },
];

const serverType = (overrides = {}) => ({
  id: 'type-new',
  babyId: BABY_ID,
  key: 'pacifier',
  name: 'Pacifier',
  icon: 'local_drink',
  color: '#1e88e5',
  hasDuration: false,
  fields: [],
  ...overrides,
});

async function setup(
  handler: (call: ApiCall) => unknown = () => undefined,
  role: BabyRole = 'Owner',
) {
  await seedBaby(db, { medications: true, role });
  const fake = fakeApi(handler);
  renderWithDb(db, <SettingsPage />, { api: fake.api });
  return fake;
}

const openSection = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name }));
};

describe('SettingsPage baby section', () => {
  it('shows the role and edits details through PUT, then refreshes', async () => {
    const { calls, writes } = await setup();

    expect(await screen.findByText('Owner')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Lia Maria' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PUT',
      path: BASE,
      body: { name: 'Lia Maria', birthDate: '2026-08-01' },
    });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/babies')).toBe(true));
  });

  it('is read-only for non owners', async () => {
    await setup(undefined, 'Parent');
    expect(await screen.findByText('Parent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save details' })).toBeNull();
    expect(screen.getByText('Only the owner can change these details.')).toBeTruthy();
  });
});

describe('SettingsPage event types', () => {
  it('lists built-in and custom types; built-ins have no edit controls', async () => {
    await setup();
    await db.eventTypes.put(serverType({ id: 'custom-1', name: 'Walk' }));
    await openSection('Event types');

    const custom = await screen.findByRole('list', { name: 'Custom event types' });
    expect(within(custom).getByText('Walk')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Walk' })).toBeTruthy();
    const builtIn = screen.getByRole('list', { name: 'Built-in event types' });
    expect(within(builtIn).getByText('Feeding')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Feeding' })).toBeNull();
  });

  it('creates a custom type with field definitions and refreshes catalogs', async () => {
    const created = serverType({
      fields: [
        {
          key: 'minutes',
          label: 'Minutes',
          kind: 'number',
          isRequired: true,
          min: 1,
          max: 60,
          unit: 'min',
        },
        {
          key: 'mood',
          label: 'Mood',
          kind: 'select',
          isRequired: false,
          options: ['happy', 'grumpy'],
        },
        { key: 'sleepy', label: 'Sleepy', kind: 'bool', isRequired: false },
        { key: 'note', label: 'Note', kind: 'text', isRequired: false },
      ],
    });
    let stored = false;
    const { calls, writes } = await setup((call) => {
      if (call.method === 'POST') {
        stored = true;
        return created;
      }
      if (call.method === 'GET' && call.path === `${BASE}/event-types`) {
        return stored ? [created] : [];
      }
    });
    await openSection('Event types');
    fireEvent.click(await screen.findByRole('button', { name: 'Add event type' }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    fireEvent.change(within_.getByLabelText(/^Name/), { target: { value: 'Pacifier' } });
    fireEvent.click(within_.getByRole('button', { name: 'star' }));
    fireEvent.click(within_.getByRole('radio', { name: 'Colour #e53935' }));

    const addField = () => fireEvent.click(within_.getByRole('button', { name: 'Add field' }));
    const pickKind = (position: number, label: string) => {
      fireEvent.mouseDown(within_.getByRole('combobox', { name: `Field ${position} type` }));
      fireEvent.click(screen.getByRole('option', { name: label }));
    };

    addField();
    fireEvent.change(within_.getByLabelText('Field 1 label'), { target: { value: 'Minutes' } });
    pickKind(1, 'Number');
    fireEvent.change(within_.getByLabelText('Field 1 min'), { target: { value: '1' } });
    fireEvent.change(within_.getByLabelText('Field 1 max'), { target: { value: '60' } });
    fireEvent.change(within_.getByLabelText('Field 1 unit'), { target: { value: 'min' } });
    fireEvent.click(within_.getByLabelText('Field 1 required'));

    addField();
    fireEvent.change(within_.getByLabelText('Field 2 label'), { target: { value: 'Mood' } });
    pickKind(2, 'Choice');
    fireEvent.change(within_.getByLabelText('Field 2 options'), {
      target: { value: 'happy\ngrumpy' },
    });

    addField();
    fireEvent.change(within_.getByLabelText('Field 3 label'), { target: { value: 'Sleepy' } });
    pickKind(3, 'Yes / no');
    expect(within_.queryByLabelText('Field 3 required')).toBeNull();

    addField();
    fireEvent.change(within_.getByLabelText('Field 4 label'), { target: { value: 'Note' } });

    fireEvent.click(within_.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      path: `${BASE}/event-types`,
      body: {
        key: 'pacifier',
        name: 'Pacifier',
        icon: 'star',
        color: '#e53935',
        hasDuration: false,
        fields: [
          {
            key: 'minutes',
            label: 'Minutes',
            kind: 'number',
            isRequired: true,
            min: 1,
            max: 60,
            unit: 'min',
          },
          {
            key: 'mood',
            label: 'Mood',
            kind: 'select',
            isRequired: false,
            options: ['happy', 'grumpy'],
          },
          { key: 'sleepy', label: 'Sleepy', kind: 'bool', isRequired: false },
          { key: 'note', label: 'Note', kind: 'text', isRequired: false },
        ],
      },
      skipUnauthorizedHandler: false,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await db.eventTypes.get('type-new'))?.fields).toHaveLength(4);
    await waitFor(() =>
      expect(calls.some((c) => c.path === `${BASE}/event-types` && c.method === 'GET')).toBe(true),
    );
  });

  it('blocks saving an invalid definition and lists the problems', async () => {
    const { writes } = await setup();
    await openSection('Event types');
    fireEvent.click(await screen.findByRole('button', { name: 'Add event type' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('Name is required.')).toBeTruthy();
    expect(within(dialog).getByText('Field 1 needs a label.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('edits a custom type with PUT and keeps its field keys', async () => {
    const { writes } = await setup((call) =>
      call.method === 'PUT' ? serverType({ name: 'Dummy' }) : undefined,
    );
    await db.eventTypes.put(
      serverType({
        id: 'custom-1',
        fields: [
          {
            key: 'minutes',
            label: 'Minutes',
            kind: 'number',
            isRequired: false,
            options: [],
            min: null,
            max: null,
            unit: null,
          },
        ],
      }),
    );
    await openSection('Event types');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Pacifier' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Dummy' } });
    fireEvent.change(within(dialog).getByLabelText('Field 1 label'), {
      target: { value: 'How long' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PUT',
      path: `${BASE}/event-types/custom-1`,
      body: {
        name: 'Dummy',
        fields: [{ key: 'minutes', label: 'How long', kind: 'number', isRequired: false }],
      },
    });
    expect(writes()[0].body).not.toHaveProperty('key');
  });

  it('explains a 409 event_type_in_use on delete and keeps the type', async () => {
    const { writes } = await setup((call) => {
      if (call.method === 'DELETE') throw httpError(409, 'event_type_in_use');
    });
    await db.eventTypes.put(serverType({ id: 'custom-1', name: 'Walk' }));
    await openSection('Event types');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Walk' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete event type' }));

    expect(await screen.findByText(/used by logged events/)).toBeTruthy();
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/event-types/custom-1` });
    expect(await db.eventTypes.get('custom-1')).toBeTruthy();
  });

  it('deletes an unused custom type', async () => {
    await setup();
    await db.eventTypes.put(serverType({ id: 'custom-1', name: 'Walk' }));
    await openSection('Event types');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Walk' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete event type' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Walk' })).toBeNull());
    expect(await db.eventTypes.get('custom-1')).toBeUndefined();
  });
});

describe('SettingsPage medications', () => {
  it('adds, edits and deletes through the local store and the outbox', async () => {
    await setup();
    await openSection('Medications');
    const list = await screen.findByRole('list', { name: 'Medications' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Add medication' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Puravit' } });
    fireEvent.change(within(dialog).getByLabelText('Default dose'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Unit'), { target: { value: 'ml' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(list).getByText('Puravit')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const created = (await db.medications.toArray()).find((m) => m.name === 'Puravit')!;
    expect(created.defaultDosage).toEqual({ amount: 5, unit: 'ml' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Puravit' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Puravit D' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Usual medication' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(list).getByText('Puravit D')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Delete Puravit D' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete medication' }));
    await waitFor(() => expect(within(list).queryByText('Puravit D')).toBeNull());

    const queue = await db.outbox.orderBy('id').toArray();
    expect(queue.map((m) => [m.kind, m.entityType])).toEqual([
      ['upsert', 'medication'],
      ['upsert', 'medication'],
      ['delete', 'medication'],
    ]);
    expect(queue[1].payload).toMatchObject({ name: 'Puravit D', isUsual: true });
  });

  it('rejects a dose without a unit', async () => {
    await setup();
    await openSection('Medications');
    fireEvent.click(await screen.findByRole('button', { name: 'Add medication' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'X' } });
    fireEvent.change(within(dialog).getByLabelText('Default dose'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('A dose needs a unit.')).toBeTruthy();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('SettingsPage members and invites', () => {
  const handler = (extra?: (call: ApiCall) => unknown) => (call: ApiCall) => {
    if (call.method === 'GET' && call.path === `${BASE}/members`) return MEMBERS;
    if (call.method === 'GET' && call.path === `${BASE}/invites`) return [];
    return extra?.(call);
  };

  it('creates an invite, shows the link once with a copy button', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    let invites: unknown[] = [];
    const { writes } = await setup((call) => {
      if (call.method === 'GET' && call.path === `${BASE}/invites`) return invites;
      if (call.method === 'POST') {
        invites = [
          {
            id: 'inv-1',
            babyId: BABY_ID,
            role: 'Viewer',
            createdBy: 'u1',
            createdAt: JOINED,
            expiresAt: '2026-10-30T10:00:00.000Z',
          },
        ];
        return { ...(invites[0] as object), token: 'secret-token' };
      }
      return handler()(call);
    });
    await openSection('Members & invites');
    expect(await screen.findByText('Bia')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Expires in (days)'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    const dialog = await screen.findByRole('dialog');
    const link = `${window.location.origin}/invite/secret-token`;
    expect((within(dialog).getByLabelText('Invite link') as HTMLInputElement).value).toBe(link);
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: `${BASE}/invites`,
      body: { role: 'Parent', expiresInDays: 14 },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(await within(dialog).findByText('Link copied.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByDisplayValue(link)).toBeNull();
    expect(screen.queryByText(/secret-token/)).toBeNull();
    const pending = await screen.findByRole('list', { name: 'Pending invites' });
    expect(within(pending).getByText('Viewer')).toBeTruthy();
  });

  it('revokes a pending invite', async () => {
    const pending = [
      {
        id: 'inv-1',
        babyId: BABY_ID,
        role: 'Parent',
        createdBy: 'u1',
        createdAt: JOINED,
        expiresAt: '2026-10-30T10:00:00.000Z',
      },
    ];
    let current: unknown[] = pending;
    const { writes } = await setup((call) => {
      if (call.method === 'DELETE') current = [];
      if (call.method === 'GET' && call.path === `${BASE}/invites`) return current;
      return handler()(call);
    });
    await openSection('Members & invites');

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Parent invite' }));

    await waitFor(() =>
      expect(writes()[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/invites/inv-1` }),
    );
    expect(await screen.findByText('No pending invites.')).toBeTruthy();
  });

  it('changes a role and removes a member; last owner errors are friendly', async () => {
    const { writes } = await setup((call) => {
      if (call.method === 'PATCH') throw httpError(409, 'last_owner_required');
      return handler()(call);
    });
    await openSection('Members & invites');
    await screen.findByText('Bia');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Role for Ana' }));
    fireEvent.click(screen.getByRole('option', { name: 'Viewer' }));
    expect(await screen.findByText(/needs at least one owner/)).toBeTruthy();
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      path: `${BASE}/members/u1`,
      body: { role: 'Viewer' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bia' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
    await waitFor(() =>
      expect(writes().at(-1)).toMatchObject({ method: 'DELETE', path: `${BASE}/members/u2` }),
    );
  });

  it('lets any member leave', async () => {
    const { writes } = await setup(handler(), 'Parent');
    await openSection('Members & invites');
    await screen.findByText('Bia');
    expect(screen.queryByRole('button', { name: 'Create invite link' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Role for Bia' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Leave this baby' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave baby' }));

    await waitFor(() =>
      expect(writes()[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/members/me` }),
    );
  });
});

describe('SettingsPage viewer', () => {
  it('shows everything read-only', async () => {
    await setup(undefined, 'Viewer');
    await db.eventTypes.put(serverType({ id: 'custom-1', name: 'Walk' }));

    expect(await screen.findByText('You have view-only access to Lia.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save details' })).toBeNull();

    await openSection('Event types');
    await screen.findByText('Walk');
    expect(screen.queryByRole('button', { name: 'Add event type' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Walk' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Walk' })).toBeNull();

    await openSection('Medications');
    await screen.findByText('Alpha tablet');
    expect(screen.queryByRole('button', { name: 'Add medication' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Alpha tablet' })).toBeNull();
    expect(screen.getByText('You can view medications but not change them.')).toBeTruthy();
  });
});

describe('SettingsPage appearance and sync', () => {
  it('toggles the theme from the appearance section', async () => {
    await setup();
    await openSection('Appearance');
    const toggle = (await screen.findByRole('switch', { name: 'Dark theme' })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
  });

  it('lists failed changes with Retry and Discard', async () => {
    await setup();
    const base = {
      babyId: BABY_ID,
      kind: 'upsert' as const,
      entityType: 'medication' as const,
      payload: {},
      createdAt: JOINED,
      attempts: 3,
      lastError: 'HTTP 422',
      nextAttemptAt: null,
    };
    const retryId = await db.outbox.add({ ...base, entityId: 'm1', status: 'dead' });
    await db.outbox.add({ ...base, entityId: 'm2', status: 'dead', kind: 'delete' });
    await openSection('Sync');

    expect(await screen.findByText('Failed changes (2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard Delete medication' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Retry Save medication' }));
    await waitFor(async () => expect((await db.outbox.get(retryId))?.status).not.toBe('dead'));
  });
});
