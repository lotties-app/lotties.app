import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { DayRow } from '../day/DayRow';
import { FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderUi } from '../test/renderUi';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { AssistantOriginNote } from './AssistantOriginNote';
import { createdVia, updatedVia } from './assistantOrigin';
import { EventSheet } from './EventSheet';

/* The assistants' origin marker (docs/design/32-assistants.md "Origin marker"). */

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
  await db.eventTypes.bulkPut([SLEEP_TYPE, FEEDING_TYPE]);
});

afterEach(async () => {
  await db.delete();
  await useTestLocale('en');
});

const stub = (payload: BabyEvent['payload']) => ({ payload });

describe('reading the origin', () => {
  it('names Alexa and any other adapter as an AI assistant', () => {
    expect(createdVia(stub({ via: 'alexa' }))).toBe('alexa');
    expect(createdVia(stub({ via: 'siri' }))).toBe('siri');
    expect(createdVia(stub({ via: 'android' }))).toBe('android');
    expect(createdVia(stub({ via: 'mcp' }))).toBe('assistant');
    expect(createdVia(stub({}))).toBeNull();
    expect(createdVia(stub({ via: 7 }))).toBeNull();
    expect(updatedVia(stub({ updated_via: 'alexa' }))).toBe('alexa');
  });
});

describe.each([
  ['en', { alexa: 'Added by Alexa', mcp: 'Added by an AI assistant' }, 'Finished by Alexa'],
  [
    'pt-BR',
    { alexa: 'Adicionado pela Alexa', mcp: 'Adicionado por um assistente de IA' },
    'Finalizado pela Alexa',
  ],
] as const)('the quiet origin line in %s', (locale, added, finished) => {
  it('says who added or finished the entry, and nothing for an app entry', async () => {
    await useTestLocale(locale);
    const { unmount } = renderUi(<AssistantOriginNote event={stub({ via: 'alexa' })} />);
    expect(screen.getByTestId('assistant-origin').textContent).toBe(added.alexa);
    unmount();
    const second = renderUi(<AssistantOriginNote event={stub({ via: 'mcp' })} />);
    expect(screen.getByTestId('assistant-origin').textContent).toBe(added.mcp);
    second.unmount();
    const third = renderUi(<AssistantOriginNote event={stub({ updated_via: 'alexa' })} />);
    expect(screen.getByTestId('assistant-origin').textContent).toBe(finished);
    third.unmount();
    renderUi(<AssistantOriginNote event={stub({ kind: 'nap' })} />);
    expect(screen.queryByTestId('assistant-origin')).toBeNull();
  });

  it('shows in the day list row', async () => {
    await useTestLocale(locale);
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: SLEEP_TYPE.id,
      startedAt: '2026-10-20T13:00:00.000Z',
      endedAt: '2026-10-20T14:00:00.000Z',
      payload: { kind: 'nap', via: 'alexa' },
    });
    renderUi(
      <ul>
        <DayRow
          event={event}
          type={SLEEP_TYPE}
          medications={[]}
          syncState={undefined}
          hasNext={false}
          onEdit={() => undefined}
        />
      </ul>,
    );
    expect(screen.getByTestId('assistant-origin').textContent).toBe(added.alexa);
  });
});

describe('editing an assistant entry in the app', () => {
  it('keeps via, updated_via and a delete request when the entry is saved', async () => {
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: SLEEP_TYPE.id,
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      endedAt: new Date(Date.now() - 1_800_000).toISOString(),
      payload: {
        kind: 'nap',
        via: 'alexa',
        updated_via: 'mcp',
        delete_requested_via: 'alexa',
        delete_requested_at: '2026-10-20T14:00:00.000Z',
      },
    });
    const onDone = vi.fn();
    renderWithDb(
      db,
      <EventSheet
        babyId={BABY_ID}
        types={[SLEEP_TYPE, FEEDING_TYPE]}
        event={event}
        onDone={onDone}
      />,
    );
    await screen.findByRole('dialog');
    expect(screen.getByTestId('assistant-origin').textContent).toBe('Added by Alexa');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(event.id))?.payload).toMatchObject({
      kind: 'nap',
      via: 'alexa',
      updated_via: 'mcp',
      delete_requested_via: 'alexa',
      delete_requested_at: '2026-10-20T14:00:00.000Z',
    });
  });
});
