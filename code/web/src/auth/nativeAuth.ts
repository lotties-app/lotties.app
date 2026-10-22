import type {
  INavigator,
  IWindow,
  NavigateParams,
  NavigateResponse,
  User,
  UserManager,
} from 'oidc-client-ts';
import type { NativeShell } from '../platform/nativeShell';

/**
 * Sign-in inside the iOS/Android app (docs/design/12-mobile-capacitor.md section 3): the identity
 * provider opens in the SYSTEM browser (RFC 8252; never in the app's WebView) and sends the browser
 * back to the app's URL scheme, registered in code/mobile (AndroidManifest.xml, Info.plist). The
 * Keycloak client lists both URIs; the web app keeps `${origin}/auth/callback` and `/login`.
 */
export const NATIVE_URL_SCHEME = 'app.lotties.app';
export const NATIVE_REDIRECT_URI = `${NATIVE_URL_SCHEME}://auth/callback`;
export const NATIVE_POST_LOGOUT_REDIRECT_URI = `${NATIVE_URL_SCHEME}://auth/logout`;

/** How long a closed browser waits for its redirect before the sign-in counts as cancelled. */
const CANCEL_GRACE_MS = 1500;

/** The user closed the system browser before the identity provider sent them back. */
export class SignInCancelledError extends Error {
  constructor() {
    super('The sign-in was closed before it completed.');
    this.name = 'SignInCancelledError';
  }
}

/** What the app does when a redirect completes. */
export interface NativeAuthHandlers {
  /** A sign-in completed: the user is stored (react-oidc-context already has it). */
  signedIn: (user: User) => void;
  /** A sign-in redirect no request waited for (the OS restarted the app) could not complete. */
  signInFailed: (error: unknown) => void;
  /** The identity provider ended its session and sent the app back. */
  signedOut: () => void;
}

type RedirectKind = 'signin' | 'signout';

function redirectKind(url: string): RedirectKind | null {
  const [address] = url.split(/[?#]/, 1);
  if (address === NATIVE_REDIRECT_URI) return 'signin';
  if (address === NATIVE_POST_LOGOUT_REDIRECT_URI) return 'signout';
  return null;
}

function stateOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('state');
  } catch {
    return null;
  }
}

function isSignInRequest(url: string): boolean {
  try {
    return new URL(url).searchParams.get('redirect_uri') === NATIVE_REDIRECT_URI;
  } catch {
    return false;
  }
}

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

interface PendingSignIn {
  resolve: (response: NavigateResponse) => void;
  reject: (error: Error) => void;
}

/**
 * The native sign-in adapter. `navigator` replaces the library's redirect navigator (which would
 * navigate the WebView itself); `attach` completes the redirects that come back. A sign-in request
 * stays pending until its redirect arrives (the auth state shows "loading" meanwhile, exactly like
 * the web, whose page unloads) or the user closes the browser (it then fails, so the landing page
 * offers a retry instead of waiting forever).
 */
export class NativeAuthRedirects {
  private pending: PendingSignIn | null = null;
  private browserClosed = false;
  private cancelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly shell: NativeShell,
    private readonly cancelGraceMs = CANCEL_GRACE_MS,
  ) {}

  /** oidc-client-ts redirect navigator: the system browser instead of this WebView. */
  readonly navigator: INavigator = {
    prepare: async (): Promise<IWindow> => ({
      navigate: (params) => this.navigate(params),
      close: () => {},
    }),
    callback: async () => {},
  };

  /**
   * Listens for the app's redirect URLs (and the one that started the app) and the browser closing,
   * and completes them on `userManager`. Returns the function that stops listening.
   */
  attach(userManager: UserManager, handlers: NativeAuthHandlers): () => void {
    let stopped = false;
    const stops: (() => void)[] = [];
    const keep = (listening: Promise<() => void>) =>
      void listening
        .then((stop) => (stopped ? stop() : stops.push(stop)))
        .catch(() => {
          // Plugin unavailable: nothing to listen to.
        });
    const onUrl = (url: string) => {
      if (!stopped) void this.complete(url, userManager, handlers);
    };

    keep(this.shell.onAppUrlOpen(onUrl));
    keep(this.shell.onBrowserFinished(() => this.onBrowserFinished()));
    this.shell
      .launchUrl()
      .then((url) => url && onUrl(url))
      .catch(() => {});

    return () => {
      stopped = true;
      stops.splice(0).forEach((stop) => stop());
      clearTimeout(this.cancelTimer);
    };
  }

  private async navigate({ url }: NavigateParams): Promise<NavigateResponse> {
    if (!isSignInRequest(url)) {
      // Sign-out: the local session is already removed; the browser only ends the provider's
      // session (so the next sign-in asks again) and comes back to the logout URI.
      await this.shell.openBrowser(url);
      return { url };
    }
    this.settle(new SignInCancelledError());
    this.browserClosed = false;
    const done = new Promise<NavigateResponse>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    this.shell.openBrowser(url).catch((error: unknown) => this.settle(asError(error)));
    return done;
  }

  private onBrowserFinished() {
    this.browserClosed = true;
    this.armCancel();
  }

  /** A closed browser cancels the pending sign-in, unless its redirect arrives within the grace. */
  private armCancel() {
    clearTimeout(this.cancelTimer);
    if (!this.pending || !this.browserClosed) return;
    this.cancelTimer = setTimeout(
      () => this.settle(new SignInCancelledError()),
      this.cancelGraceMs,
    );
  }

  private settle(error: Error) {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private async complete(url: string, userManager: UserManager, handlers: NativeAuthHandlers) {
    const kind = redirectKind(url);
    if (kind === 'signout') {
      void this.shell.closeBrowser().catch(() => {});
      await userManager.signoutCallback(url).catch(() => undefined);
      handlers.signedOut();
      return;
    }
    if (kind !== 'signin') return;

    clearTimeout(this.cancelTimer);
    // Only a redirect for a request this device started and has not completed yet: a duplicate
    // delivery, the launch URL read again after a reload, or a foreign link is ignored.
    const state = stateOf(url);
    const awaited = state !== null && (await userManager.settings.stateStore.get(state)) !== null;
    if (!awaited) {
      this.armCancel();
      return;
    }

    const pending = this.pending;
    this.pending = null;
    void this.shell.closeBrowser().catch(() => {});
    try {
      const user = await userManager.signinCallback(url);
      if (user) handlers.signedIn(user);
      pending?.resolve({ url });
    } catch (error) {
      if (pending) pending.reject(asError(error));
      else handlers.signInFailed(error);
    }
  }
}
