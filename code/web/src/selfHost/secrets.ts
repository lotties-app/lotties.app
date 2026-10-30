/**
 * Secrets for the self-host generator, made in the browser with WebCrypto. Nothing is stored or sent: the
 * values live in component state until the page is closed.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

type RandomFill = (array: Uint8Array<ArrayBuffer>) => Uint8Array;

const defaultFill: RandomFill = (array) => globalThis.crypto.getRandomValues(array);

/** A random password of letters and digits (no character that needs quoting), unbiased by rejection sampling. */
export function randomPassword(length = 32, fill: RandomFill = defaultFill): string {
  const limit = 256 - (256 % ALPHABET.length);
  let result = '';
  while (result.length < length) {
    for (const byte of fill(new Uint8Array(length * 2))) {
      if (byte < limit && result.length < length) result += ALPHABET[byte % ALPHABET.length];
    }
  }
  return result;
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface VapidPair {
  /** Base64url, uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** Base64url, the 32-byte private scalar (what the API's `--generate-vapid-keys` prints). */
  privateKey: string;
}

/** A VAPID key pair in the same format as `dotnet Lotties.Api.dll --generate-vapid-keys`. */
export async function generateVapidPair(
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<VapidPair> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('The browser did not export the private key.');
  return { publicKey: base64Url(publicKey), privateKey: jwk.d };
}
