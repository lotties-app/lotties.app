import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { cryAssetsPlugin } from './cry-assets';
import { nativeCspPlugin } from './native-csp';
import { darkManifestPlugin, LIGHT_MANIFEST } from './pwa-manifest';
import { buildDefines } from './build-info';

/** Matches modules of the given top-level packages (bundler module ids use forward slashes). */
const vendor = (...packages: string[]) =>
  new RegExp(`node_modules[\\/](${packages.join('|')})[\\/]`);

/** MUI's per-language strings (`@mui/material/locale`). */
const MUI_LOCALES = /@mui[\\/]material[\\/](esm[\\/])?locale[\\/]/;

/** The date pickers (and date-fns) load on demand with the date field: keep them out of vendor-mui. */
const LAZY_PICKERS = /@mui[\\/]x-date-pickers[\\/]/;

/**
 * Per-checkout caches (gitignored): git worktrees share node_modules through a junction, so the
 * default node_modules/.vite and node_modules/.vitest-cache would be shared by every checkout.
 */
const CACHE_DIR = '.vite-cache';

/** The short commit git reports for this checkout (throws without git). */
const gitCommit = () =>
  execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

export default defineConfig({
  cacheDir: CACHE_DIR,
  // Stamped when the bundle is built (so a deploy carries its own release): the About screen and the
  // version lines. APP_VERSION / APP_COMMIT / APP_BUILD_TIME come from deploy.sh; without them: dev.
  define: buildDefines(process.env, gitCommit, new Date()),
  plugins: [
    react(),
    VitePWA({
      // The user decides when to reload; see src/pwa/ReloadPrompt.tsx.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: [
        'favicon.svg',
        'favicon.png',
        'favicon.ico',
        'favicon-dark.png',
        'favicon-dark.ico',
        'apple-touch-icon.png',
        'apple-touch-icon-dark.png',
        'icon.svg',
      ],
      // Light variant; the dark one is emitted by darkManifestPlugin (pwa-manifest.ts).
      manifest: LIGHT_MANIFEST,
      // Our own TypeScript worker (src/pwa/sw/sw.ts, built to sw.js): precache, cleanup,
      // navigation fallback and SKIP_WAITING. Only built, hashed assets are precached; API calls
      // and the OIDC callback are never cached (see src/pwa/sw/navigation.ts). The only runtime cache
      // holds the cry monitor's files under /models/cry/ (src/pwa/sw/cryAssets.ts).
      strategies: 'injectManifest',
      srcDir: 'src/pwa/sw',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // The cry monitor's model and MediaPipe WASM (11 MB) are cached at run time only, on first use
        // (src/pwa/sw/cryAssets.ts), never precached for every visitor.
        globIgnores: ['**/node_modules/**/*', 'models/**'],
      },
    }),
    // After VitePWA: it also removes the duplicate manifest link VitePWA injects.
    darkManifestPlugin(),
    // Native build only: the app has no server to send a Content-Security-Policy header.
    nativeCspPlugin(),
    // The cry monitor's MediaPipe WASM under /models/cry/wasm/ and the model check (cry-assets.ts).
    cryAssetsPlugin(),
  ],
  // ES-module workers: the cry classifier worker loads MediaPipe's ES-module WASM loader, and the capture
  // AudioWorklet (`?worker&url`) must be a module (src/cry, docs/design/35-cry-engine.md).
  worker: {
    format: 'es',
  },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: cached across deploys, and none of them near the 500 kB limit.
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: vendor('react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'),
              priority: 40,
            },
            {
              name: 'vendor-auth',
              test: vendor('oidc-client-ts', 'react-oidc-context', 'jwt-decode'),
              priority: 30,
            },
            {
              name: 'vendor-data',
              test: vendor('dexie', 'dexie-react-hooks', '@tanstack'),
              priority: 30,
            },
            {
              name: 'vendor-mui',
              // MUI's per-language strings stay out: pt-BR loads them with its own lazy chunk. The
              // date pickers stay out too: they belong to the lazy date field.
              test: (id: string) =>
                vendor('@mui', '@emotion').test(id) &&
                !MUI_LOCALES.test(id) &&
                !LAZY_PICKERS.test(id),
              priority: 20,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // jsdom + MUI renders (and the lazy date pickers) are slow when the machine is busy (CI, parallel builds)
    testTimeout: 30000,
    fsModuleCachePath: `${CACHE_DIR}/vitest-modules`,
  },
});
