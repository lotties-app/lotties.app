export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Shares plain text: the Web Share sheet where the browser has one, else the clipboard. Never
 * throws; the result says what happened so the caller can tell the user ("Copied").
 */
export async function shareText(text: string): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      // Dismissing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
