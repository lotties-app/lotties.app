import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { useTestLocale } from '../test/locale';
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

const MCP_URL = 'https://lotties.example/api/v1/mcp';
const AUTHORITY = 'https://id.example/realms/lotties.app';

function renderMcp(
  mcp: { mcpEnabled?: boolean; mcpUrl?: string | null },
  authority: string | null = AUTHORITY,
) {
  const { api } = fakeApi((call) =>
    call.path === PATH ? { defaultBabyId: null, updatedAt: null, ...mcp } : undefined,
  );
  renderWithDb(db, <VoiceAssistantsSection babies={BABIES} authority={authority} />, { api });
}

function renderSection(
  babies: Baby[],
  stored: string | null = null,
  onPut?: (call: ApiCall) => unknown,
  sayBabyName?: boolean,
) {
  let saySaved = sayBabyName;
  const { api, calls } = fakeApi((call) => {
    if (call.path !== PATH) return undefined;
    if (call.method === 'PUT') {
      const body = call.body as { defaultBabyId: string | null; sayBabyName?: boolean };
      if (body.sayBabyName !== undefined) saySaved = body.sayBabyName;
      return (
        onPut?.(call) ?? {
          defaultBabyId: body.defaultBabyId,
          updatedAt: '2026-10-23T12:00:00Z',
          ...(saySaved === undefined ? {} : { sayBabyName: saySaved }),
        }
      );
    }
    return {
      defaultBabyId: stored,
      updatedAt: stored ? '2026-10-22T12:00:00Z' : null,
      ...(saySaved === undefined ? {} : { sayBabyName: saySaved }),
    };
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

  it('hides the AI assistants panel while the server has MCP off (or does not say)', async () => {
    renderMcp({ mcpEnabled: false, mcpUrl: null });
    await screen.findByLabelText('Baby for voice commands');
    expect(screen.queryByText('AI assistants (MCP)')).toBeNull();
  });

  it('shows the MCP URL, the privacy note and the link to the connected apps', async () => {
    renderMcp({ mcpEnabled: true, mcpUrl: MCP_URL });

    expect(await screen.findByRole('heading', { name: 'AI assistants (MCP)' })).toBeTruthy();
    const url = screen.getByLabelText('MCP server URL') as HTMLInputElement;
    expect(url.value).toBe(MCP_URL);
    expect(url.readOnly).toBe(true);
    expect(url.getAttribute('aria-describedby')).toBe('mcp-connector-url-hint');
    expect(screen.getByText(/read-only unless you also approve logging/)).toBeTruthy();
    const manage = screen.getByRole('link', { name: /Manage connected apps/ });
    expect(manage.getAttribute('href')).toBe(`${AUTHORITY}/account/applications`);
    expect(manage.getAttribute('target')).toBe('_blank');
    expect(manage.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('copies the URL and says so, or explains a failed copy', async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderMcp({ mcpEnabled: true, mcpUrl: MCP_URL });

    fireEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByText('URL copied.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(MCP_URL);

    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByText("Couldn't copy. Select the URL and copy it.")).toBeTruthy();
  });

  it('leaves out the connected apps link without a configured authority', async () => {
    renderMcp({ mcpEnabled: true, mcpUrl: MCP_URL }, null);

    expect(await screen.findByLabelText('MCP server URL')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Manage connected apps/ })).toBeNull();
  });

  describe('the switch to say the baby name in answers', () => {
    const LABEL = "Say my baby's name in answers";

    it('is off by default (also from an older server that does not say), with the reason beside it', async () => {
      renderSection(BABIES);

      const toggle = (await screen.findByRole('switch', { name: LABEL })) as HTMLInputElement;

      expect(toggle.checked).toBe(false);
      expect(toggle.disabled).toBe(false);
      expect(toggle.getAttribute('aria-describedby')).toBe('voice-assistants-name-hint');
      expect(document.getElementById('voice-assistants-name-hint')?.textContent).toContain(
        'a name ties your child to what you ask',
      );
      expect(screen.getByText(/The answer has no baby name unless you turn on/)).toBeTruthy();
    });

    it('shows the stored value', async () => {
      renderSection(BABIES, 'b1', undefined, true);

      const toggle = (await screen.findByRole('switch', { name: LABEL })) as HTMLInputElement;

      expect(toggle.checked).toBe(true);
    });

    it('turns on and off through the settings route, keeping the chosen baby', async () => {
      const calls = renderSection(BABIES, 'b2');

      fireEvent.click(await screen.findByRole('switch', { name: LABEL }));
      expect(await screen.findByText('Saved.')).toBeTruthy();
      await waitFor(() =>
        expect((screen.getByRole('switch', { name: LABEL }) as HTMLInputElement).checked).toBe(
          true,
        ),
      );
      fireEvent.click(screen.getByRole('switch', { name: LABEL }));
      await waitFor(() =>
        expect((screen.getByRole('switch', { name: LABEL }) as HTMLInputElement).checked).toBe(
          false,
        ),
      );

      const puts = calls.filter((call) => call.method === 'PUT');
      expect(puts.map((call) => [call.path, call.body])).toEqual([
        [PATH, { defaultBabyId: 'b2', sayBabyName: true }],
        [PATH, { defaultBabyId: 'b2', sayBabyName: false }],
      ]);
    });

    it('still works for a user who logs for no baby (a Viewer): the setting is hers', async () => {
      const calls = renderSection([baby('b3', 'Zoe', 'Viewer')]);

      fireEvent.click(await screen.findByRole('switch', { name: LABEL }));

      await waitFor(() =>
        expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
          defaultBabyId: null,
          sayBabyName: true,
        }),
      );
    });

    it('explains a refused save and leaves the switch where it was', async () => {
      renderSection(BABIES, null, () => {
        throw httpError(400, 'validation_failed');
      });

      fireEvent.click(await screen.findByRole('switch', { name: LABEL }));

      expect(await screen.findByText(/can't be used for voice commands/)).toBeTruthy();
      expect((screen.getByRole('switch', { name: LABEL }) as HTMLInputElement).checked).toBe(false);
    });

    it('reads in Brazilian Portuguese', async () => {
      await useTestLocale('pt-BR');
      renderSection(BABIES);

      const toggle = (await screen.findByRole('switch', {
        name: 'Falar o nome do bebê nas respostas',
      })) as HTMLInputElement;

      expect(toggle.checked).toBe(false);
      expect(screen.getByText(/então um nome liga o seu filho ao que você pergunta/)).toBeTruthy();
      expect(
        screen.getByText(/A resposta não tem o nome do bebê, a menos que você ative/),
      ).toBeTruthy();
    });
  });
});

describe('VoiceAssistantsSection, medicine names switch', () => {
  const MEDICINE_LABEL = 'Say the names of my medicines in answers';

  function renderMedicines(stored?: boolean, onPut?: (call: ApiCall) => unknown) {
    let saved = stored;
    const { api, calls } = fakeApi((call) => {
      if (call.path !== PATH) return undefined;
      if (call.method === 'PUT') {
        const body = call.body as { defaultBabyId: string | null; sayMedicineNames?: boolean };
        if (body.sayMedicineNames !== undefined) saved = body.sayMedicineNames;
        return (
          onPut?.(call) ?? {
            defaultBabyId: body.defaultBabyId,
            updatedAt: '2026-10-23T12:00:00Z',
            ...(saved === undefined ? {} : { sayMedicineNames: saved }),
          }
        );
      }
      return {
        defaultBabyId: null,
        updatedAt: null,
        ...(saved === undefined ? {} : { sayMedicineNames: saved }),
      };
    });
    renderWithDb(db, <VoiceAssistantsSection babies={BABIES} />, { api });
    return calls;
  }

  it('is off by default and explains why', async () => {
    renderMedicines();

    const toggle = (await screen.findByRole('switch', {
      name: MEDICINE_LABEL,
    })) as HTMLInputElement;

    expect(toggle.checked).toBe(false);
    expect(screen.getByText(/a medicine name tells them what your child takes/)).toBeTruthy();
  });

  it('shows the stored value', async () => {
    renderMedicines(true);

    const toggle = (await screen.findByRole('switch', {
      name: MEDICINE_LABEL,
    })) as HTMLInputElement;

    expect(toggle.checked).toBe(true);
  });

  it('turns on and off through the settings route without touching the baby name', async () => {
    const calls = renderMedicines();

    fireEvent.click(await screen.findByRole('switch', { name: MEDICINE_LABEL }));
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: MEDICINE_LABEL }) as HTMLInputElement).checked,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('switch', { name: MEDICINE_LABEL }));
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: MEDICINE_LABEL }) as HTMLInputElement).checked,
      ).toBe(false),
    );

    const puts = calls.filter((call) => call.method === 'PUT');
    expect(puts.map((call) => call.body)).toEqual([
      { defaultBabyId: null, sayMedicineNames: true },
      { defaultBabyId: null, sayMedicineNames: false },
    ]);
  });

  it('explains a refused save and leaves the switch where it was', async () => {
    renderMedicines(undefined, () => {
      throw httpError(400, 'validation_failed');
    });

    fireEvent.click(await screen.findByRole('switch', { name: MEDICINE_LABEL }));

    expect(await screen.findByText(/can't be used for voice commands/)).toBeTruthy();
    expect((screen.getByRole('switch', { name: MEDICINE_LABEL }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('reads in Brazilian Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderMedicines();

    const toggle = (await screen.findByRole('switch', {
      name: 'Falar o nome dos remédios nas respostas',
    })) as HTMLInputElement;

    expect(toggle.checked).toBe(false);
    expect(
      screen.getByText(/o nome de um remédio mostra a eles o que o seu filho toma/),
    ).toBeTruthy();
  });
});
