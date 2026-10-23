import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeNativeShell } from './nativeTestKit';
import { blobToBase64, saveFile } from './saveFile';

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:file');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
  vi.restoreAllMocks();
});

describe('saveFile', () => {
  it('downloads through a link in a browser, started before any await', () => {
    const downloads: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, href: this.href });
    });
    const shell = fakeNativeShell();

    void saveFile(new Blob(['{}']), 'backup.json', shell, false);

    expect(downloads).toEqual([{ name: 'backup.json', href: 'blob:file' }]);
    expect(shell.shared).toEqual([]);
  });

  it('reports false when the browser cannot create object URLs', async () => {
    (URL as { createObjectURL?: unknown }).createObjectURL = undefined;

    expect(await saveFile(new Blob(['{}']), 'a.json', fakeNativeShell(), false)).toBe(false);
  });

  it('hands the file to the share sheet inside the native app', async () => {
    const shell = fakeNativeShell();

    const saved = await saveFile(
      new Blob(['{"a":1}'], { type: 'application/json' }),
      'backup.json',
      shell,
      true,
    );

    expect(saved).toBe(true);
    expect(shell.shared).toEqual([
      { name: 'backup.json', mimeType: 'application/json', base64: btoa('{"a":1}') },
    ]);
  });
});

describe('blobToBase64', () => {
  it('encodes bytes beyond one chunk and non-ASCII text', async () => {
    const big = new Uint8Array(70_000).fill(65);
    expect(await blobToBase64(new Blob([big]))).toBe(btoa('A'.repeat(70_000)));
    expect(await blobToBase64(new Blob(['é']))).toBe('w6k=');
  });
});
