import Dexie from 'dexie';
import { accountDatabaseName } from '../../session/accountDatabase';
import { clearAccountDeviceState } from '../../session/deviceState';

/** Issuer of every demo account (docs/design/45-try-it-demo.md); the API marks the user row with it too. */
export const DEMO_ISSUER = 'urn:lotties:demo';

const STORAGE_KEY = 'lotties.demo.session';

/** The throwaway credential of a demo account, kept in localStorage until the demo ends. */
export interface DemoSession {
  accessToken: string;
  /** ISO instant the server deletes the account. */
  expiresAt: string;
  /** The token's `sub` (random). */
  sub: string;
}

export const demoAccountId = (sub: string) => `${DEMO_ISSUER}|${sub}`;

export const isDemoAccountId = (accountId: string | null | undefined) =>
  !!accountId && accountId.startsWith(`${DEMO_ISSUER}|`);

/** Reads the `sub` of a JWT payload without verifying it (the server does); `null` when malformed. */
export function subjectOfToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) =>
        c.charCodeAt(0),
      ),
    );
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

export function isExpired(session: DemoSession, now = Date.now()): boolean {
  const at = Date.parse(session.expiresAt);
  return Number.isNaN(at) || at <= now;
}

function readStored(): DemoSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DemoSession>;
    if (
      typeof value.accessToken !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      typeof value.sub !== 'string'
    ) {
      return null;
    }
    return { accessToken: value.accessToken, expiresAt: value.expiresAt, sub: value.sub };
  } catch {
    return null;
  }
}

/** The stored demo session, or `null` when there is none, it is malformed or it has expired. */
export function readDemoSession(now = Date.now()): DemoSession | null {
  const session = readStored();
  return session && !isExpired(session, now) ? session : null;
}

export function writeDemoSession(session: DemoSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearDemoSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

/**
 * Ends the demo on this device: deletes the demo account's local database and entries, forgets the
 * token. The server account simply expires; demo data is never carried over to a real account.
 */
export async function endDemoSession(): Promise<void> {
  const stored = readStored();
  clearDemoSession();
  if (stored) {
    try {
      await Dexie.delete(accountDatabaseName(demoAccountId(stored.sub)));
    } catch {
      // Isolated in its own database anyway.
    }
  }
  clearAccountDeviceState();
}

/** Ends the demo, then loads `/` (or `/?signup=1` to open the account creation) from scratch. */
export async function leaveDemo(options: { register?: boolean } = {}): Promise<void> {
  await endDemoSession();
  window.location.assign(options.register ? '/?signup=1' : '/');
}
