import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { VoiceAssistantsSection } from './VoiceAssistantsSection';

/* Settings > Voice assistants: the default baby of voice commands, among the babies the user logs for. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

const baby = (id: string, name: string, role: Baby['role']): Baby => ({
  id,
  name,
  birthDate: '2026-08-01',
  role,
});

const BABIES = [
  baby('b1', 'Lia', 'Owner'),
  baby('b2', 'Noah', 'Caregiver'),
  baby('b3', 'Zoe', 'Viewer'),
  baby('b4', 'Patient', 'Doctor'),
];

const PATH = '/api/v1/me/assistant-settings';

function renderSection(
  babies: Baby[],
  stored: string | null = null,
  onPut?: (call: ApiCall) => unknown,
) {
  const { api, calls } = fakeApi((call) => {
    if (call.path !== PATH) return undefined;
    if (call.method === 'PUT') {
      return (
        onPut?.(call) ?? {
          defaultBabyId: (call.body as { defaultBabyId: string | null }).defaultBabyId,
          updatedAt: '2026-10-23T12:00:00Z',
        }
      );
    }
    return { defaultBabyId: stored, updatedAt: stored ? '2026-10-22T12:00:00Z' : null };
  });
  renderWithDb(db, <VoiceAssistantsSection babies={babies} />, { api });
  return calls;
}

describe('VoiceAssistantsSection', () => {
  it('offers only the babies the user logs for, with the stored choice selected', async () => {
    renderSection(BABIES, 'b2');

    const select = (await screen.findByLabelText('Baby for voice commands')) as HTMLSelectElement;

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Not chosen',
      'Lia',
      'Noah',
    ]);
    expect(select.value).toBe('b2');
    expect(select.getAttribute('aria-describedby')).toBe('voice-assistants-hint');
    expect(screen.getByText(/choose the one voice commands log and answer for/)).toBeTruthy();
  });

  it('saves a choice and says so', async () => {
    const calls = renderSection(BABIES);

    fireEvent.change(await screen.findByLabelText('Baby for voice commands'), {
      target: { value: 'b1' },
    });

    expect(await screen.findByText('Saved.')).toBeTruthy();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe(PATH);
    expect(put?.body).toEqual({ defaultBabyId: 'b1' });
  });

  it('clears the choice with "Not chosen"', async () => {
    const calls = renderSection(BABIES, 'b1');

    fireEvent.change(await screen.findByLabelText('Baby for voice commands'), {
      target: { value: '' },
    });

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ defaultBabyId: null }),
    );
  });

  it('shows a stored baby the user no longer logs for as not chosen', async () => {
    renderSection(BABIES, 'b3');

    const select = (await screen.findByLabelText('Baby for voice commands')) as HTMLSelectElement;

    expect(select.value).toBe('');
  });

  it('names the only baby the user logs for', async () => {
    renderSection([baby('b1', 'Lia', 'Parent'), baby('b3', 'Zoe', 'Viewer')]);

    expect(
      await screen.findByText('You log for one baby, so voice commands use Lia.'),
    ).toBeTruthy();
  });

  it('explains a refused save', async () => {
    renderSection(BABIES, null, () => {
      throw httpError(400, 'validation_failed');
    });

    fireEvent.change(await screen.findByLabelText('Baby for voice commands'), {
      target: { value: 'b2' },
    });

    expect(
      await screen.findByText(
        "This baby can't be used for voice commands. Choose a baby you log for.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Saved.')).toBeNull();
  });
});
