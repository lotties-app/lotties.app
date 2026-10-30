/*
 * Whether this browser can run the cry monitor (docs/design/35-cry-engine.md section 8): the microphone
 * (`getUserMedia`, only in a secure context), an AudioWorklet, WebAssembly and module workers. Detected
 * once per page load; the Hub hides the entry without them and the page says so when reached by URL.
 * Nothing here loads the engine.
 */

/** The browser globals the check reads; injectable for tests. */
export interface CryMonitorEnvironment {
  getUserMedia?: unknown;
  AudioWorkletNode?: unknown;
  WebAssembly?: unknown;
  Worker?: unknown;
}

export function detectCryMonitorSupport(env: CryMonitorEnvironment): boolean {
  return (
    typeof env.getUserMedia === 'function' &&
    typeof env.AudioWorkletNode === 'function' &&
    typeof env.WebAssembly === 'object' &&
    env.WebAssembly !== null &&
    typeof env.Worker === 'function'
  );
}

function browserEnvironment(): CryMonitorEnvironment {
  const scope = globalThis as typeof globalThis & {
    AudioWorkletNode?: unknown;
    WebAssembly?: unknown;
    Worker?: unknown;
  };
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return {
    getUserMedia: devices?.getUserMedia,
    AudioWorkletNode: scope.AudioWorkletNode,
    WebAssembly: scope.WebAssembly,
    Worker: scope.Worker,
  };
}

let cached: boolean | undefined;

/** This browser's answer, detected on the first call. */
export function cryMonitorSupported(): boolean {
  if (cached === undefined) {
    try {
      cached = detectCryMonitorSupport(browserEnvironment());
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** Tests only: forget the cached answer (or force one). */
export function resetCryMonitorSupport(value?: boolean): void {
  cached = value;
}
