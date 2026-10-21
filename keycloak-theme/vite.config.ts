import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { keycloakify } from 'keycloakify/vite-plugin';

// Login theme only. Version targeting: see README ("Keycloak version targets").
// Default: one jar for "all other versions" (Keycloak 26+ and every release not listed by Keycloakify).
// `KC_TARGETS=all npm run build-keycloak-theme` also builds the 22-25 jars (and older ones Keycloakify supports).
const allTargets = process.env.KC_TARGETS === 'all';

export default defineConfig({
  plugins: [
    react(),
    keycloakify({
      themeName: 'baby-routine',
      accountThemeImplementation: 'none',
      ...(allTargets
        ? {}
        : {
            keycloakVersionTargets: {
              '22-to-25': false,
              'all-other-versions': 'keycloak-theme-for-kc-all-other-versions.jar',
            },
          }),
    }),
  ],
  build: { sourcemap: false },
});
