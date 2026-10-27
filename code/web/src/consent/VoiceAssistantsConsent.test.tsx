import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { VoiceAssistantsSection } from '../settings/VoiceAssistantsSection';
import { fakeApi, testDatabase, type ApiCall } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { ConsentProvider } from './ConsentProvider';
import { CONSENTS_PATH, acceptedView, grantedCore } from './consentTestData';

/* Settings > Voice assistants: the sentences of docs/CONSENT-AND-TERMS-DRAFT.md section 3 next to the switches, and the records. */

const LIA: Baby = { id: 'b1', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const SETTINGS = '/api/v1/me/assistant-settings';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  await db.delete();
});

function renderSection(options: { mcp?: boolean; alexaOn?: boolean } = {}) {
  const { api, calls } = fakeApi((call: ApiCall) => {
    if (call.path === SETTINGS) {
      return {
        defaultBabyId: 'b1',
        updatedAt: null,
        mcpEnabled: options.mcp ?? false,
        mcpUrl: options.mcp ? 'https://lotties.example/api/v1/mcp' : null,
      };
    }
    if (call.path.startsWith(CONSENTS_PATH)) {
      return acceptedView({
        optional: {
          push: null,
          alexa: options.alexaOn ? grantedCore({ capacity: null }) : null,
          mcp: null,
        },
      });
    }
    return undefined;
  });
  renderWithDb(
    db,
    <ConsentProvider>
      <VoiceAssistantsSection babies={[LIA]} authority={null} />
    </ConsentProvider>,
    { api },
  );
  return calls;
}

const optionalPuts = (calls: ApiCall[]) =>
  calls.filter((call) => call.method === 'PUT' && call.path.includes('/optional/'));

describe('voice assistants consent', () => {
  it('shows the Alexa, baby-name and medicine-name sentences next to their switches', async () => {
    renderSection();

    expect(
      await screen.findByRole('switch', { name: 'I use the Lotties skill with Alexa' }),
    ).toBeTruthy();
    expect(screen.getByText(/Amazon records and processes your voice/)).toBeTruthy();
    expect(
      screen.getByText(
        /Answers sent to Amazon or your AI assistant will include the child's name\./,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Answers will include medicine names, which tells them what the child takes\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'I connect an AI assistant' })).toBeNull();
  });

  it('records the Alexa consent when the switch is turned on, then off', async () => {
    const calls = renderSection();
    const alexa = await screen.findByRole('switch', { name: 'I use the Lotties skill with Alexa' });
    await waitFor(() => expect(calls.some((call) => call.path === CONSENTS_PATH)).toBe(true));

    fireEvent.click(alexa);
    await waitFor(() => expect(optionalPuts(calls)).toHaveLength(1));
    expect(optionalPuts(calls)[0]).toMatchObject({
      path: `${CONSENTS_PATH}/optional/alexa`,
      body: { granted: true, locale: 'en' },
    });
    expect((alexa as HTMLInputElement).checked).toBe(true);

    fireEvent.click(alexa);
    await waitFor(() => expect(optionalPuts(calls)).toHaveLength(2));
    expect(optionalPuts(calls)[1].body).toMatchObject({ granted: false });
  });

  it('starts from what the server has recorded', async () => {
    renderSection({ alexaOn: true });

    const alexa = await screen.findByRole('switch', { name: 'I use the Lotties skill with Alexa' });
    await waitFor(() => expect((alexa as HTMLInputElement).checked).toBe(true));
  });

  it('offers the AI assistant switch, with its sentence, only when the server has MCP on', async () => {
    const calls = renderSection({ mcp: true });

    const mcp = await screen.findByRole('switch', { name: 'I connect an AI assistant' });
    expect(screen.getByText(/Connect only an assistant you trust\./)).toBeTruthy();
    fireEvent.click(mcp);
    await waitFor(() => expect(optionalPuts(calls)).toHaveLength(1));
    expect(optionalPuts(calls)[0].path).toBe(`${CONSENTS_PATH}/optional/mcp`);
  });

  it('shows the sentences in Brazilian Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderSection({ mcp: true });

    expect(
      await screen.findByRole('switch', { name: 'Eu uso a skill do Lotties com a Alexa' }),
    ).toBeTruthy();
    expect(screen.getByText(/a Amazon grava e processa a sua voz/)).toBeTruthy();
    expect(screen.getByText(/passa a incluir o nome da criança/)).toBeTruthy();
    expect(screen.getByText(/passa a incluir o nome dos remédios/)).toBeTruthy();
    expect(screen.getByText(/Conecte só um assistente em que você confia/)).toBeTruthy();
  });
});
