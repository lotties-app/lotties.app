/** Build-time env values the worker reads (Vite replaces them when it bundles sw.ts). */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** `true` turns the cry monitor on (src/cryMonitor/featureFlag.ts); anything else is off. */
  readonly VITE_CRY_MONITOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
