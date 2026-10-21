import { createGetKcContextMock } from 'keycloakify/login/KcContext';
import type { KcContextExtension, KcContextExtensionPerPage } from './KcContext';

// Only used by `npm run dev` (see src/main.tsx): mock Keycloak context per page.
export const { getKcContextMock } = createGetKcContextMock<KcContextExtension, KcContextExtensionPerPage>({
  kcContextExtension: { themeName: 'baby-routine', properties: {} },
  kcContextExtensionPerPage: {},
  overrides: {},
  overridesPerPage: {},
});
