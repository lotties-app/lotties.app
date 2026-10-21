import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareText } from './shareText';

afterEach(() => {
  for (const key of ['share', 'clipboard'] as const) Reflect.deleteProperty(navigator, key);
  vi.restoreAllMocks();
});

const define = (key: string, value: unknown) =>
  Object.defineProperty(navigator, key, { value, configurable: true });

describe('shareText', () => {
  it('uses the share sheet when the browser has one', async () => {
    const share = vi.fn(async () => undefined);
    define('share', share);
    expect(await shareText('hello')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'hello' });
  });

  it('treats dismissing the share sheet as a cancel, not a failure', async () => {
    define(
      'share',
      vi.fn(async () => Promise.reject(new DOMException('no', 'AbortError'))),
    );
    const writeText = vi.fn(async () => undefined);
    define('clipboard', { writeText });
    expect(await shareText('hello')).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard without Web Share, or when sharing fails', async () => {
    const writeText = vi.fn(async () => undefined);
    define('clipboard', { writeText });
    expect(await shareText('one')).toBe('copied');
    define(
      'share',
      vi.fn(async () => Promise.reject(new Error('boom'))),
    );
    expect(await shareText('two')).toBe('copied');
    expect(writeText).toHaveBeenNthCalledWith(1, 'one');
    expect(writeText).toHaveBeenNthCalledWith(2, 'two');
  });

  it('reports a failure when nothing can share', async () => {
    define('clipboard', { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    expect(await shareText('x')).toBe('failed');
  });
});
