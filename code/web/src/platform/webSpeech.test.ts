import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListenRequest, ListenState } from './speechTypes';
import { createWebSpeechEngine, webSpeechConstructor, type RecognitionLike } from './webSpeech';

/* The `web` engine over a scripted SpeechRecognition (docs/design/49a-voice-lab.md). */

class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null;
  lang = '';
  maxAlternatives = 1;
  interimResults = true;
  continuous = true;
  onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onresult: RecognitionLike['onresult'] = null;
  onnomatch: (() => void) | null = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = 0;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started += 1;
  }
  abort() {
    this.aborted += 1;
  }
  answer(...texts: string[]) {
    const result = Object.assign(
      texts.map((transcript, i) => ({ transcript, confidence: i === 0 ? 0.9 : 0 })),
      { isFinal: true },
    );
    this.onresult?.({ results: [result] });
    this.onend?.();
  }
}

const REQUEST: ListenRequest = { locale: 'pt-BR', hints: [], maxResults: 5, timeoutMs: 15_000 };

afterEach(() => {
  vi.useRealTimers();
  FakeRecognition.last = null;
});

describe('web speech engine', () => {
  it('finds the prefixed or standard constructor, or none', () => {
    expect(webSpeechConstructor({})).toBeNull();
    expect(webSpeechConstructor({ webkitSpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
    expect(webSpeechConstructor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
  });

  it('asks once for the n-best list and reports the states and the end of speech', async () => {
    let clock = 100;
    const engine = createWebSpeechEngine(FakeRecognition, () => clock);
    const states: ListenState[] = [];
    const listening = engine.listen(REQUEST, (s) => states.push(s));
    const recognition = FakeRecognition.last as FakeRecognition;
    expect(recognition).toMatchObject({
      lang: 'pt-BR',
      maxAlternatives: 5,
      interimResults: false,
      continuous: false,
      started: 1,
    });
    recognition.onaudiostart?.();
    recognition.onspeechstart?.();
    clock = 900;
    recognition.onspeechend?.();
    clock = 1300;
    recognition.answer('mamadeira de 120', 'mamadeira de 20');
    await expect(listening).resolves.toEqual({
      alternatives: ['mamadeira de 120', 'mamadeira de 20'],
      confidences: [0.9, null],
      startedAt: 100,
      endOfSpeechAt: 900,
      resultAt: 1300,
      onDevice: null,
    });
    expect(states).toEqual(['starting', 'ready', 'speech', 'processing']);
    expect(recognition.onresult).toBeNull();
  });

  it.each([
    ['no-speech', 'speech_timeout'],
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['network', 'network'],
    ['audio-capture', 'audio'],
    ['language-not-supported', 'language_unavailable'],
    ['something-new', 'recognizer_error'],
  ])('maps the error %s to %s and releases the recogniser', async (name, code) => {
    const engine = createWebSpeechEngine(FakeRecognition);
    const listening = engine.listen(REQUEST, () => undefined);
    const recognition = FakeRecognition.last as FakeRecognition;
    recognition.onerror?.({ error: name });
    await expect(listening).rejects.toMatchObject({ code });
    expect(recognition.aborted).toBe(1);
    // Free again: a new listen starts.
    void engine.listen(REQUEST, () => undefined).catch(() => undefined);
    expect(FakeRecognition.last).not.toBe(recognition);
    await engine.cancel();
  });

  it('refuses a second listen while one runs, and cancels', async () => {
    const engine = createWebSpeechEngine(FakeRecognition);
    const first = engine.listen(REQUEST, () => undefined);
    await expect(engine.listen(REQUEST, () => undefined)).rejects.toMatchObject({ code: 'busy' });
    await engine.cancel();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect((FakeRecognition.last as FakeRecognition).aborted).toBe(1);
  });

  it('gives up after the timeout, and an end without a result is no match', async () => {
    vi.useFakeTimers();
    const engine = createWebSpeechEngine(FakeRecognition);
    const timed = engine.listen({ ...REQUEST, timeoutMs: 1000 }, () => undefined);
    vi.advanceTimersByTime(1000);
    await expect(timed).rejects.toMatchObject({ code: 'timeout' });

    const ended = engine.listen(REQUEST, () => undefined);
    (FakeRecognition.last as FakeRecognition).onend?.();
    await expect(ended).rejects.toMatchObject({ code: 'no_match' });
  });
});
