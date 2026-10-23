import { isNativeApp } from './nativeApp';
import { capacitorShell, type NativeShell } from './nativeShell';

/** The bytes of `file` as base64, without a data-URL prefix. */
export async function blobToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Gives the person a file: in a browser a download (a link to an object URL, clicked once, started
 * before the first await so callers and tests see it at once); inside the native app the system share
 * sheet, where "Save to Files" or another app takes it. Returns `false` when the browser cannot
 * create object URLs.
 */
export async function saveFile(
  file: Blob,
  name: string,
  shell: NativeShell = capacitorShell,
  native: boolean = isNativeApp(),
): Promise<boolean> {
  if (native) {
    await shell.shareFile({
      name,
      mimeType: file.type || 'application/octet-stream',
      base64: await blobToBase64(file),
    });
    return true;
  }
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the time the task ends; revoking later keeps slow browsers safe.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
