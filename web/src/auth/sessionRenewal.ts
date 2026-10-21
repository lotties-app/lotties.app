import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from '../sync/backoff';
import {
  isDefinitiveRenewalFailure,
  SessionEndedError,
  TokenRenewalPendingError,
} from './renewalErrors';

/** The parts of an `oidc-client-ts` `User` the renewal needs. */
export interface RenewableUser {
  access_token: string;
  refresh_token?: string;
  /** `true` once the access token has expired (computed from `expires_at` on every read). */
  readonly expired?: boolean;
}

/** The parts of an `oidc-client-ts` `UserManager` the renewal needs (mocked in tests). */
export interface RenewalUserManager {
  /** The stored user, expired or not (`null` when signed out). */
  getUser(): Promise<RenewableUser | null>;
  /** Uses the stored refresh token; stores and returns the renewed user. */
  signinSilent(): Promise<RenewableUser | null>;
}

/**
 * - `idle`: nothing to do (the token is valid, or no renewal was needed yet);
 * - `renewing`: a refresh is in flight;
 * - `waiting`: the token is stale and the last attempt could not reach the identity provider
 *   (offline or a transient error); retried with backoff and on `online`;
 * - `ended`: the refresh token was rejected for good, the user must sign in again.
 */
export type RenewalStatus = 'idle' | 'renewing' | 'waiting' | 'ended';

export interface SessionRenewalOptions {
  userManager: RenewalUserManager;
  isOnline?: () => boolean;
  /** Receives `online` events; defaults to `window`. */
  eventTarget?: EventTarget | null;
  backoff?: Partial<BackoffOptions>;
  /** Epoch milliseconds. */
  now?: () => number;
  /** Called once when the session ends (the refresh token was rejected). */
  onEnded?: () => void | Promise<void>;
}

function defaultIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Keeps an OIDC session alive with its refresh token, offline-first: an expired access token never
 * signs the user out by itself. Renewal is single-flight (concurrent callers share one refresh, so
 * a rotating refresh token is never used twice), retried with backoff while the identity provider
 * cannot be reached, and declared over only when the token endpoint rejects the refresh token.
 */
export class SessionRenewal {
  private readonly userManager: RenewalUserManager;
  private readonly isOnline: () => boolean;
  private readonly eventTarget: EventTarget | null;
  private readonly backoff: BackoffOptions;
  private readonly now: () => number;
  private readonly onEnded?: () => void | Promise<void>;

  private status: RenewalStatus = 'idle';
  private readonly listeners = new Set<() => void>();
  private inFlight: Promise<RenewableUser> | null = null;
  private attempts = 0;
  private retryAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(options: SessionRenewalOptions) {
    this.userManager = options.userManager;
    this.isOnline = options.isOnline ?? defaultIsOnline;
    this.eventTarget =
      options.eventTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.eventTarget;
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.now = options.now ?? (() => Date.now());
    this.onEnded = options.onEnded;
  }

  getSnapshot = (): RenewalStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Listens for `online` (a waiting renewal is retried at once). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.eventTarget?.addEventListener('online', this.handleOnline);
  }

  stop(): void {
    this.started = false;
    this.eventTarget?.removeEventListener('online', this.handleOnline);
    this.clearRetryTimer();
  }

  /** Forgets an ended or waiting state (call when a fresh, valid user signed in). */
  reset(): void {
    this.attempts = 0;
    this.retryAt = 0;
    this.clearRetryTimer();
    if (!this.inFlight) this.setStatus('idle');
  }

  /**
   * The access token to send: the stored one while it is valid; after it expired, the token of a
   * renewal (awaited, shared with concurrent callers). Throws `TokenRenewalPendingError` while
   * the renewal cannot complete (offline, identity provider unreachable) and `SessionEndedError`
   * when the session is over. `null` when signed out. A stale token without a refresh token is
   * returned as is (the server decides).
   */
  async getAccessToken(): Promise<string | null> {
    if (this.status === 'ended') throw new SessionEndedError();
    const user = await this.userManager.getUser();
    if (!user) return null;
    if (!user.expired || !user.refresh_token) return user.access_token;
    return (await this.renew()).access_token;
  }

  /** Whether the stored access token has expired (a renewal is needed before requests). */
  async needsRenewal(): Promise<boolean> {
    const user = await this.userManager.getUser();
    return !!user?.expired && !!user.refresh_token;
  }

  /**
   * Renews the access token with the refresh token (single-flight). While `waiting`, calls before
   * the backoff elapsed fail fast instead of hitting the identity provider again; `force` (the
   * retry timer, `online`, a 401 from the API) skips that wait.
   */
  renew({ force = false }: { force?: boolean } = {}): Promise<RenewableUser> {
    if (this.status === 'ended') return Promise.reject(new SessionEndedError());
    if (this.inFlight) return this.inFlight;
    if (!this.isOnline()) {
      this.setStatus('waiting');
      return Promise.reject(new TokenRenewalPendingError());
    }
    if (!force && this.status === 'waiting' && this.retryAt > this.now()) {
      return Promise.reject(new TokenRenewalPendingError());
    }
    this.setStatus('renewing');
    this.inFlight = this.attempt().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async attempt(): Promise<RenewableUser> {
    let user: RenewableUser | null;
    try {
      user = await this.userManager.signinSilent();
    } catch (error) {
      if (isDefinitiveRenewalFailure(error)) return this.end();
      return this.wait();
    }
    if (!user) return this.wait();
    this.attempts = 0;
    this.retryAt = 0;
    this.clearRetryTimer();
    this.setStatus('idle');
    return user;
  }

  private async end(): Promise<never> {
    this.clearRetryTimer();
    this.setStatus('ended');
    await this.onEnded?.();
    throw new SessionEndedError();
  }

  private wait(): never {
    this.attempts += 1;
    const delay = backoffDelay(this.attempts, this.backoff);
    this.retryAt = this.now() + delay;
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.renew({ force: true }).catch(() => {});
    }, delay);
    this.setStatus('waiting');
    throw new TokenRenewalPendingError();
  }

  private setStatus(next: RenewalStatus): void {
    if (next === this.status) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private readonly handleOnline = () => {
    if (this.status === 'waiting') this.renew({ force: true }).catch(() => {});
  };
}
