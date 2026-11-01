/**
 * Saves an `.ics` text through a Blob link (the browser's download, which phones offer to open in
 * the calendar app). Returns `false` when the browser cannot create object URLs.
 *
 * TODO(mobile): inside the Capacitor shell a download link goes nowhere; hand the file to the share
 * sheet instead (`isNativeApp()`, lazily imported plugins), docs/design/12-mobile-capacitor.md.
 */
export function downloadIcs(text: string, fileName: string): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
