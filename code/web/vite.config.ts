import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { darkManifestPlugin, LIGHT_MANIFEST } from './pwa-manifest';

/** Matches modules of the given top-level packages (bundler module ids use forward slashes). */
const vendor = (...packages: string[]) =>
  new RegExp(`node_modules[\\/](${packages.join('|')})[\\/]`);

/** MUI's per-language strings (`@mui/material/locale`). */
const MUI_LOCALES = /@mui[\\/]material[\\/](esm[\\/])?locale[\\/]/;

/** The date pickers (and date-fns) load on demand with the date field: keep them out of vendor-mui. */
const LAZY_PICKERS = /@mui[\\/]x-date-pickers[\\/]/;

export default defineConfig({
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
      // and the OIDC callback are never cached (no runtime caching, see src/pwa/sw/navigation.ts).
      strategies: 'injectManifest',
      srcDir: 'src/pwa/sw',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
      },
    }),
    // After VitePWA: it also removes the duplicate manifest link VitePWA injects.
    darkManifestPlugin(),
  ],
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
  },
});
