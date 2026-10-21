import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Matches modules of the given top-level packages (bundler module ids use forward slashes). */
const vendor = (...packages: string[]) =>
  new RegExp(`node_modules[\\/](${packages.join('|')})[\\/]`);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The user decides when to reload; see src/pwa/ReloadPrompt.tsx.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Baby Routine',
        short_name: 'Baby Routine',
        description:
          'Track baby events offline, share with a co-parent, and see routine predictions.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // The night background (docs/DESIGN.md section 1); light mode is handled by the media metas.
        theme_color: '#15132e',
        background_color: '#15132e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Only built, hashed assets are precached. API calls and the OIDC callback are never
        // cached: no runtimeCaching rules exist, and navigations under these paths skip the fallback.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
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
            { name: 'vendor-mui', test: vendor('@mui', '@emotion'), priority: 20 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15000, // jsdom + MUI renders are slow when the machine is busy (CI, parallel builds)
  },
});
