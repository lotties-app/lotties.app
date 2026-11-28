import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { clearAppLog, getAppLogEntries } from '../logs/appLog';
import { renderUi } from '../test/renderUi';
import { fakeSpeech, type FakeReply, type FakeSpeechOptions } from './fakeSpeech';
import type { LabExport } from './labModel';
import VoiceLabPage from './VoiceLabPage';

/*
 * The voice lab page over scripted engines (docs/design/49a-voice-lab.md). Rendered with the language
 * and theme providers only: no database, no API, no account. Nothing it hears reaches the console or
 * the app's log.
 */

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  clearAppLog();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  expect(getAppLogEntries()).toEqual([]);
});

function renderLab(options: Partial<FakeSpeechOptions> & { replies: readonly FakeReply[] }) {
  const platform = fakeSpeech(options);
  const save = vi.fn<(file: Blob, name: string) => Promise<boolean>>(async () => true);
  renderUi(<VoiceLabPage platform={platform} save={save} />);
  return { platform, save };
}

const speak = () => fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
const phraseCard = () => within(screen.getByTestId('voice-lab-phrase'));

describe('VoiceLabPage', () => {
  it('shows the first phrase, its expected command and what the phone reports', async () => {
    renderLab({ replies: [] });
    expect(screen.getByRole('heading', { name: 'Voice lab', level: 1 })).toBeTruthy();
    expect(phraseCard().getByText('mamadeira de 120 ml')).toBeTruthy();
    expect(phraseCard().getByText('Phrase 1 of 24 (test phrase #1)')).toBeTruthy();
    expect(phraseCard().getByText('Expected: Bottle 120 ml')).toBeTruthy();
    const box = within(screen.getByTestId('voice-lab-capabilities'));
    expect(await box.findByText('Installed')).toBeTruthy();
    expect(box.getByText('15 (API 35)')).toBeTruthy();
  });

  it('listens with the hints, shows the n-best texts, the parse and a pass, then moves on', async () => {
    const { platform } = renderLab({ replies: [['mamadeira de 120 ml', 'mamadeira de 20 ml']] });
    speak();
    expect(await phraseCard().findByText('Pass')).toBeTruthy();
    expect(phraseCard().getByText('Parsed: Bottle 120 ml')).toBeTruthy();
    expect(phraseCard().getByText('mamadeira de 20 ml')).toBeTruthy();
    expect(phraseCard().getByText(/^Latency: 0[.,]4\d s$/)).toBeTruthy();
    expect(platform.calls).toEqual([expect.objectContaining({ locale: 'pt-BR' })]);
    expect(platform.calls[0].hints).toContain('mamadeira');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(phraseCard().getByText('mamadeira de 90')).toBeTruthy();
  });

  it('keeps the first attempt for the measures when a failure is retried, and counts the retry', async () => {
    renderLab({ replies: [['mamadeira de 20 ml'], ['mamadeira de 120 ml']] });
    speak();
    expect(await phraseCard().findByText('Fail')).toBeTruthy();
    expect(phraseCard().getByText('Would log the wrong entry')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await phraseCard().findByText('Pass')).toBeTruthy();
    expect(phraseCard().getByText('1 retry (the first attempt counts)')).toBeTruthy();
    const summary = within(screen.getByTestId('voice-lab-summary'));
    expect(summary.getByText('0% (below target)')).toBeTruthy();
  });

  it('offers no engine choice: on-device recognition only, with no server or web option', () => {
    renderLab({ replies: [] });
    expect(screen.getByText(/Recognised on this phone only/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Server' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Web' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect((screen.getByRole('button', { name: 'Speak' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('has nothing to listen with outside the phone app', async () => {
    renderLab({ replies: [['dormiu']], hasEngine: false });
    speak();
    expect(await screen.findByText(/only in the phone app/)).toBeTruthy();
    expect(screen.getByText('No attempts yet.')).toBeTruthy();
  });

  it('says when on-device recognition is missing, records nothing and never tries a server', async () => {
    const { platform } = renderLab({ replies: [{ error: 'on_device_unavailable' }] });
    speak();
    expect(
      await screen.findByText(/On-device recognition is not available on this phone/),
    ).toBeTruthy();
    expect(platform.calls).toHaveLength(1);
    expect(screen.getByText('No attempts yet.')).toBeTruthy();
  });

  it('shows the listening state and releases the engine on Cancel and when the app is hidden', async () => {
    const { platform } = renderLab({ replies: ['hang'] });
    speak();
    expect(await screen.findByText('Listening. Speak now.')).toBeTruthy();
    // A second tap cannot start another listen: the button is gone while listening.
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    expect(platform.cancels).toBe(1);

    speak();
    await screen.findByText('Listening. Speak now.');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(
      await screen.findByText('Listening stopped because the app left the screen.'),
    ).toBeTruthy();
    visibility.mockRestore();
    expect(platform.cancels).toBe(2);
    expect(screen.getByText('No attempts yet.')).toBeTruthy();
  });

  it('exports the test phrases and the summary, never the free tries', async () => {
    const { save } = renderLab({ replies: [['dormiu agora'], ['mamadeira de 120 ml']] });
    fireEvent.click(screen.getByRole('button', { name: 'Speak (free try)' }));
    const free = within(screen.getByTestId('voice-lab-free'));
    expect(await free.findByText('Parsed: Fell asleep')).toBeTruthy();
    speak();
    await phraseCard().findByText('Pass');
    fireEvent.click(screen.getByRole('button', { name: 'Export results' }));
    expect(await screen.findByText('Results exported.')).toBeTruthy();
    const [file, name] = save.mock.calls[0];
    expect(name).toMatch(/^lotties-voice-lab-\d{8}-\d{4}\.json$/);
    const exported = JSON.parse(await file.text()) as LabExport;
    expect(exported.format).toBe('lotties-voice-lab');
    expect(exported.attempts.map((a) => a.phrase)).toEqual(['mamadeira de 120 ml']);
    expect(JSON.stringify(exported)).not.toContain('dormiu agora');
  });

  it('logs the keys a Bluetooth button sends while the key logger is open', () => {
    renderLab({ replies: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Key logger' }));
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' });
    expect(screen.getByText(/key PageDown, code PageDown$/)).toBeTruthy();
  });
});
