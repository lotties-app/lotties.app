import { isNativeApp as isNative } from '../platform/nativeApp';
import { saveFile } from '../platform/saveFile';

/**
 * Saves an `.ics` text: the browser's download (which phones offer to open in the calendar app), or
 * the system share sheet inside the native app. Returns `false` when the browser cannot create object
 * URLs.
 */
export function downloadIcs(text: string, fileName: string): boolean {
  if (typeof URL.createObjectURL !== 'function' && !isNative()) return false;
  void saveFile(new Blob([text], { type: 'text/calendar;charset=utf-8' }), fileName);
  return true;
}
