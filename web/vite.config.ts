import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
        'apple-touch-icon.png',
        'icon.svg',
      ],
      manifest: {
        name: 'Baby Routine',
        short_name: 'Baby Routine',
        description:
          'Track baby events offline, share with a co-parent, and see routine predictions.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // The dark scheme's background (docs/design/TOKENS.md); the app keeps the theme-color meta
        // in sync with the shown scheme.
        theme_color: '#1b1814',
        background_color: '#1b1814',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-monochrome-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
      },
      workbox: {
        // Only built, hashed assets are precached. API calls and the OIDC callback are never
        // cached: no runtimeCaching rules exist, and navigations under these paths skip the fallback.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/auth\/callback/],
      },
    }),
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
