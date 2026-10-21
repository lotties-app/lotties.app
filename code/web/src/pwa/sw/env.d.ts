/** Build-time env values the worker reads (Vite replaces them when it bundles sw.ts). */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
