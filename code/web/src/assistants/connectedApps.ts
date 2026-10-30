import { readConfig } from '../config/appConfig';

/*
 * Where a user manages the AI assistants she connected over MCP (docs/MCP.md "Revoke"): the
 * identity provider's account console, Applications page. Lotties signs in with Keycloak, whose
 * account console lives under the realm's issuer (the configured OIDC authority).
 */

/** The account console's Applications page of `authority` (`https://id/realms/x/account/applications`). */
export function connectedAppsUrl(authority: string): string {
  return `${authority.trim().replace(/\/+$/, '')}/account/applications`;
}

/** The configured OIDC authority, or `null` when the app has none (then the link is not shown). */
export function configuredAuthority(): string | null {
  const config = readConfig();
  return config.ok ? config.config.oidc.authority : null;
}
