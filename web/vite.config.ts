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
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'Baby Routine',
        short_name: 'Baby Routine',
        start_url: '/',
        display: 'standalone',
        theme_color: '#1976d2',
        background_color: '#ffffff',
        icons: [],
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
  },
});
