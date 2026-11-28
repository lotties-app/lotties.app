import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { clearAppLog, getAppLogEntries } from '../logs/appLog';
import { renderUi } from '../test/renderUi';
import { fakeSpeech, type FakeReply, type FakeSpeechOptions } from './fakeSpeech';
import type { LabExport } from './labModel';
import VoiceLabPage from './VoiceLabPage';

/*
 * The voice test page over scripted engines (docs/design/49a-voice-lab.md). Rendered with the language
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

const radio = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
/** The guided test in Portuguese (the page starts in "Try it", in the app's language). */
const guidedInPortuguese = () => {
  radio('Guided test');
  radio('Português');
};
const speak = () => fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
const tapToSpeak = () => fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
const phraseCard = () => within(screen.getByTestId('voice-lab-phrase'));
const openTechnicalDetails = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));

describe('VoiceLabPage', () => {
  it('opens on Try it, says nothing is recorded and keeps the technical details folded', async () => {
    renderLab({ replies: [] });
    expect(
      screen.getByRole('heading', { name: 'Voice test (experimental)', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText('Nothing is recorded.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Try it' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tap to speak' })).toBeTruthy();
    expect(screen.queryByTestId('voice-lab-guided')).toBeNull();
    // The app is in English: so is the language spoken, until changed.
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const technical = screen.getByRole('button', { name: 'Technical details' });
    expect(technical.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('voice-lab-capabilities')).toBeNull();
    expect(screen.queryByTestId('voice-lab-keys')).toBeNull();
    openTechnicalDetails();
    const box = within(screen.getByTestId('voice-lab-capabilities'));
    expect(await box.findByText('Installed')).toBeTruthy();
    expect(box.getByText('15 (API 35)')).toBeTruthy();
  });

  it('Try it says what Lotties would do, never that it logged', async () => {
    renderLab({
      replies: [['mamadeira de 120 ml'], ['quanto leite ela tomou hoje'], ['não dormiu']],
    });
    radio('Português');
    tapToSpeak();
    const free = within(screen.getByTestId('voice-lab-free'));
    expect(await free.findByText('Lotties would log: Bottle 120 ml')).toBeTruthy();
    expect(free.getByText('“mamadeira de 120 ml”')).toBeTruthy();
    expect(free.getByText(/This was only a test: nothing was logged/)).toBeTruthy();
    tapToSpeak();
    expect(
      await free.findByText('Lotties would answer how much milk was drunk today'),
    ).toBeTruthy();
    tapToSpeak();
    expect(await free.findByText('Lotties would not log anything (a negation).')).toBeTruthy();
    expect(screen.queryByText(/^Logged/)).toBeNull();
  });

  it('Try it shows a setup problem plainly and keeps no try', async () => {
    renderLab({ replies: [{ error: 'denied' }] });
    tapToSpeak();
    expect(await screen.findByText(/permission was refused/)).toBeTruthy();
    expect(screen.queryByTestId('voice-lab-attempt')).toBeNull();
  });

  it('shows the first phrase of the guided test and its expected command', () => {
    renderLab({ replies: [] });
    guidedInPortuguese();
    expect(phraseCard().getByText('mamadeira de 120 ml')).toBeTruthy();
    expect(phraseCard().getByText('Phrase 1 of 24 (test phrase #1)')).toBeTruthy();
    expect(phraseCard().getByText('Expected: Bottle 120 ml')).toBeTruthy();
  });

  it('listens with the hints, shows the n-best texts, the parse and a pass, then moves on', async () => {
    const { platform } = renderLab({ replies: [['mamadeira de 120 ml', 'mamadeira de 20 ml']] });
    guidedInPortuguese();
    speak();
    expect(await phraseCard().findByText('Pass')).toBeTruthy();
    expect(phraseCard().getByText('Understood as: Bottle 120 ml')).toBeTruthy();
    expect(phraseCard().getByText('mamadeira de 20 ml')).toBeTruthy();
    expect(phraseCard().getByText(/^Latency: 0[.,]4\d s$/)).toBeTruthy();
    expect(platform.calls).toEqual([expect.objectContaining({ locale: 'pt-BR' })]);
    expect(platform.calls[0].hints).toContain('mamadeira');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(phraseCard().getByText('mamadeira de 90')).toBeTruthy();
  });

  it('keeps the first attempt for the measures when a failure is retried, and counts the retry', async () => {
    renderLab({ replies: [['mamadeira de 20 ml'], ['mamadeira de 120 ml']] });
    guidedInPortuguese();
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
    guidedInPortuguese();
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
    guidedInPortuguese();
    speak();
    expect(await screen.findByText(/only in the phone app/)).toBeTruthy();
    expect(screen.getByText('No attempts yet.')).toBeTruthy();
  });

  it('says plainly when the phone cannot recognise on the device, records nothing and never tries a server', async () => {
    const { platform } = renderLab({
      replies: [{ error: 'on_device_unavailable' }],
      capabilities: { onDeviceAvailable: false, onDeviceReason: 'api_below_31' },
    });
    expect(
      await screen.findByText(/cannot recognise this language on the device, so the voice test/),
    ).toBeTruthy();
    guidedInPortuguese();
    speak();
    expect(
      await screen.findByText(/On-device recognition is not available on this phone/),
    ).toBeTruthy();
    expect(platform.calls).toHaveLength(1);
    expect(screen.getByText('No attempts yet.')).toBeTruthy();
  });

  it('shows the listening state and releases the engine on Cancel and when the app is hidden', async () => {
    const { platform } = renderLab({ replies: ['hang'] });
    guidedInPortuguese();
    speak();
    expect(await screen.findByText('Listening. Speak now.')).toBeTruthy();
    // A second tap cannot start another listen: the button is gone while listening, and the mode
    // cannot change under it.
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    expect((screen.getByRole('radio', { name: 'Try it' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
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
    radio('Português');
    tapToSpeak();
    const free = within(screen.getByTestId('voice-lab-free'));
    expect(await free.findByText('Lotties would log: Fell asleep')).toBeTruthy();
    radio('Guided test');
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
    // What the privacy policy says the file holds besides the test phrases: the app version and
    // what the phone reported (platform, system version, languages, permissions), nothing else.
    expect(Object.keys(exported).sort()).toEqual(
      [
        'app',
        'attempts',
        'capabilities',
        'exportedAt',
        'format',
        'hints',
        'summary',
        'version',
      ].sort(),
    );
    expect(Object.keys(exported.app).sort()).toEqual([
      'commit',
      'osVersion',
      'platform',
      'version',
    ]);
  });

  it('keeps the free tries on screen when switching modes, and only the last five', async () => {
    renderLab({ replies: [['dormiu']] });
    radio('Português');
    for (let i = 0; i < 6; i += 1) {
      tapToSpeak();
      await screen.findAllByText('Lotties would log: Fell asleep');
      await screen.findByRole('button', { name: 'Tap to speak' });
    }
    expect(screen.getAllByTestId('voice-lab-attempt')).toHaveLength(5);
    radio('Guided test');
    radio('Try it');
    expect(screen.getAllByTestId('voice-lab-attempt')).toHaveLength(5);
  });

  it('logs the keys a Bluetooth button sends while the key logger is open', () => {
    renderLab({ replies: [] });
    openTechnicalDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Key logger' }));
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' });
    expect(screen.getByText(/key PageDown, code PageDown$/)).toBeTruthy();
  });
});
