import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeNativeShell, type FakeNativeShell } from '../platform/nativeTestKit';
import {
  NATIVE_POST_LOGOUT_REDIRECT_URI,
  NATIVE_REDIRECT_URI,
  NativeAuthRedirects,
  SignInCancelledError,
  type NativeAuthHandlers,
} from './nativeAuth';

const AUTHORITY = 'https://auth.test/realms/lotties.app';
const METADATA = {
  issuer: AUTHORITY,
  authorization_endpoint: `${AUTHORITY}/protocol/openid-connect/auth`,
  token_endpoint: `${AUTHORITY}/protocol/openid-connect/token`,
  end_session_endpoint: `${AUTHORITY}/protocol/openid-connect/logout`,
};
const GRACE_MS = 30;

const signedInUser = { state: { returnTo: '/day' }, profile: { sub: 'parent' } } as unknown as User;

interface Setup {
  shell: FakeNativeShell;
  userManager: UserManager;
  handlers: { [K in keyof NativeAuthHandlers]: ReturnType<typeof vi.fn> };
  stop: () => void;
}

const stops: (() => void)[] = [];

/** A real UserManager wired to the adapter, as OidcAuthProvider builds it inside the app. */
function setup(shell: FakeNativeShell = fakeNativeShell()): Setup {
  const native = new NativeAuthRedirects(shell, GRACE_MS);
  const userManager = new UserManager(
    {
      authority: AUTHORITY,
      client_id: 'lotties-web',
      redirect_uri: NATIVE_REDIRECT_URI,
      post_logout_redirect_uri: NATIVE_POST_LOGOUT_REDIRECT_URI,
      scope: 'openid offline_access',
      metadata: METADATA,
      userStore: new WebStorageStateStore({ store: window.localStorage }),
    },
    native.navigator,
  );
  const handlers = { signedIn: vi.fn(), signInFailed: vi.fn(), signedOut: vi.fn() };
  const stop = native.attach(userManager, handlers);
  stops.push(stop);
  return { shell, userManager, handlers, stop };
}

/** Starts a sign-in and waits until the system browser shows the authorization request. */
async function startSignIn({ shell, userManager }: Setup) {
  const signin = userManager.signinRedirect({ state: { returnTo: '/day' } });
  await vi.waitFor(() => expect(shell.opened).toHaveLength(1));
  const request = new URL(shell.opened[0]);
  return { signin, state: request.searchParams.get('state')!, request };
}

const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    () => 'rejected',
  );

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

describe('NativeAuthRedirects', () => {
  it('opens the authorization request in the system browser with the app redirect URI', async () => {
    const context = setup();
    const before = window.location.href;

    const { request } = await startSignIn(context);

    expect(`${request.origin}${request.pathname}`).toBe(METADATA.authorization_endpoint);
    expect(request.searchParams.get('redirect_uri')).toBe(NATIVE_REDIRECT_URI);
    expect(request.searchParams.get('code_challenge_method')).toBe('S256');
    expect(window.location.href).toBe(before);
  });

  it('completes the sign-in when the redirect comes back to the app', async () => {
    const context = setup();
    const callback = vi
      .spyOn(context.userManager, 'signinCallback')
      .mockResolvedValue(signedInUser);
    const { signin, state } = await startSignIn(context);

    const url = `${NATIVE_REDIRECT_URI}?code=abc&state=${state}`;
    context.shell.openAppUrl(url);

    await expect(signin).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledWith(url);
    expect(context.handlers.signedIn).toHaveBeenCalledWith(signedInUser);
    expect(context.shell.closeBrowser).toHaveBeenCalled();
  });

  it('keeps the sign-in pending until its redirect arrives', async () => {
    const context = setup();
    const { signin } = await startSignIn(context);

    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 2));

    expect(await Promise.race([settled(signin), Promise.resolve('pending')])).toBe('pending');
  });

  it('ignores a redirect whose state this device did not issue', async () => {
    const context = setup();
    const callback = vi.spyOn(context.userManager, 'signinCallback');
    const { signin } = await startSignIn(context);

    context.shell.openAppUrl(`${NATIVE_REDIRECT_URI}?code=abc&state=forged`);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(callback).not.toHaveBeenCalled();
    expect(await Promise.race([settled(signin), Promise.resolve('pending')])).toBe('pending');
  });

  it('cancels the sign-in when the user closes the browser', async () => {
    const context = setup();
    const { signin } = await startSignIn(context);

    context.shell.finishBrowser();

    await expect(signin).rejects.toBeInstanceOf(SignInCancelledError);
  });

  it('still completes a redirect that arrives just after the browser closed', async () => {
    const context = setup();
    vi.spyOn(context.userManager, 'signinCallback').mockResolvedValue(signedInUser);
    const { signin, state } = await startSignIn(context);

    context.shell.finishBrowser();
    context.shell.openAppUrl(`${NATIVE_REDIRECT_URI}?code=abc&state=${state}`);

    await expect(signin).resolves.toBeUndefined();
    expect(context.handlers.signedIn).toHaveBeenCalled();
  });

  it('fails the pending sign-in when the provider answers with an error', async () => {
    const context = setup();
    const refused = new Error('access_denied');
    vi.spyOn(context.userManager, 'signinCallback').mockRejectedValue(refused);
    const { signin, state } = await startSignIn(context);

    context.shell.openAppUrl(`${NATIVE_REDIRECT_URI}?error=access_denied&state=${state}`);

    await expect(signin).rejects.toBe(refused);
    expect(context.handlers.signInFailed).not.toHaveBeenCalled();
  });

  it('completes the redirect that started the app after the OS stopped it', async () => {
    const first = setup();
    const { state } = await startSignIn(first);
    first.stop();

    const shell = fakeNativeShell();
    shell.launch = `${NATIVE_REDIRECT_URI}?code=abc&state=${state}`;
    const spy = vi.spyOn(UserManager.prototype, 'signinCallback').mockResolvedValue(signedInUser);
    const restarted = setup(shell);

    await vi.waitFor(() => expect(restarted.handlers.signedIn).toHaveBeenCalledWith(signedInUser));
    expect(spy).toHaveBeenCalledWith(shell.launch);
  });

  it('reports a failed launch redirect, which no request waits for', async () => {
    const first = setup();
    const { state } = await startSignIn(first);
    first.stop();

    const shell = fakeNativeShell();
    shell.launch = `${NATIVE_REDIRECT_URI}?code=abc&state=${state}`;
    vi.spyOn(UserManager.prototype, 'signinCallback').mockRejectedValue(new Error('expired'));
    const restarted = setup(shell);

    await vi.waitFor(() => expect(restarted.handlers.signInFailed).toHaveBeenCalled());
  });

  it('signs out through the system browser and returns at once', async () => {
    const context = setup();

    await context.userManager.signoutRedirect();

    const request = new URL(context.shell.opened[0]);
    expect(`${request.origin}${request.pathname}`).toBe(METADATA.end_session_endpoint);
    expect(request.searchParams.get('post_logout_redirect_uri')).toBe(
      NATIVE_POST_LOGOUT_REDIRECT_URI,
    );

    context.shell.openAppUrl(
      `${NATIVE_POST_LOGOUT_REDIRECT_URI}?state=${request.searchParams.get('state')}`,
    );
    await vi.waitFor(() => expect(context.handlers.signedOut).toHaveBeenCalled());
    expect(context.shell.closeBrowser).toHaveBeenCalled();
  });

  it('ignores app URLs that are not its redirects', async () => {
    const context = setup();
    const callback = vi.spyOn(context.userManager, 'signinCallback');

    context.shell.openAppUrl('app.lotties.app://quick/bottle');
    context.shell.openAppUrl('https://lotties.app/auth/callback?code=abc&state=x');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(callback).not.toHaveBeenCalled();
    expect(context.handlers.signedOut).not.toHaveBeenCalled();
  });

  it('stops listening when detached', async () => {
    const context = setup();
    await vi.waitFor(() => expect(context.shell.listenerCount()).toBe(2));

    context.stop();

    expect(context.shell.listenerCount()).toBe(0);
  });
});
