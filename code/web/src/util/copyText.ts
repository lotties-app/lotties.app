/**
 * Copies plain text: the async Clipboard API where it works, else a hidden textarea and
 * `document.execCommand('copy')` (older WebViews, a page that is not a secure context). Never throws;
 * false when neither worked, so the caller can say so.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: try the fallback.
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
