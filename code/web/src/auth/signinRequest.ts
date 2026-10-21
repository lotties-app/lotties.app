import { UserManager, type SigninRedirectArgs } from 'oidc-client-ts';
import { currentLocale } from '../i18n/i18n';

/** What `login` accepts besides the path to return to. */
export interface LoginOptions {
  /** Opens the identity provider's account creation instead of its sign-in form. */
  register?: boolean;
}

export interface LoginState {
  returnTo?: string;
}

/**
 * Keycloak's authorization endpoint ends in `/protocol/openid-connect/auth`; its registration
 * entry point is the sibling `/registrations` (same parameters). `null` for any other provider.
 */
export function registrationEndpoint(authorizationEndpoint: string | undefined): string | null {
  if (!authorizationEndpoint) return null;
  const url = new URL(authorizationEndpoint);
  if (!url.pathname.endsWith('/protocol/openid-connect/auth')) return null;
  url.pathname = url.pathname.replace(/\/auth$/, '/registrations');
  return url.toString();
}

/**
 * The authorization request parameters of every sign-in: where to return to, the app's language
 * (the identity provider opens in it) and the API audience, if configured. A per-request
 * `extraQueryParams` replaces the one of the settings, so the audience is repeated here.
 */
export function signinArgs(returnTo: string | undefined, audience?: string): SigninRedirectArgs {
  return {
    state: { returnTo } satisfies LoginState,
    ui_locales: currentLocale(),
    extraQueryParams: audience ? { audience } : undefined,
  };
}

/**
 * Starts the sign-in at the registration entry point. Keycloak before 26.1 has no OIDC
 * `prompt=create`; its `/registrations` endpoint is used instead, through a manager that shares the
 * settings and state storage of `userManager` (so the callback is handled as usual). Other
 * providers get `prompt=create` on their normal endpoint (OIDC Initiated User Registration).
 */
export async function registerRedirect(
  userManager: UserManager,
  args: SigninRedirectArgs,
): Promise<void> {
  const metadata = await userManager.metadataService.getMetadata();
  const endpoint = registrationEndpoint(metadata.authorization_endpoint);
  if (!endpoint) {
    await userManager.signinRedirect({ ...args, prompt: 'create' });
    return;
  }
  const registrar = new UserManager({
    ...userManager.settings,
    metadata: { ...metadata, authorization_endpoint: endpoint },
  });
  await registrar.signinRedirect(args);
}
