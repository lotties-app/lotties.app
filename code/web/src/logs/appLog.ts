/**
 * Lightweight in-memory application log for in-app diagnostics. Captures sync, prediction, auth,
 * and general app events so users can screenshot or copy logs without external tools. Entries
 * are kept in a circular buffer (max 200) and survive page navigation but not full reloads.
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'sync' | 'prediction' | 'auth' | 'event' | 'app';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  detail?: unknown;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];

export function appLog(
  category: LogCategory,
  message: string,
  detail?: unknown,
  level: LogLevel = 'info',
): void {
  const entry: LogEntry = { timestamp: Date.now(), level, category, message, detail };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function getAppLogEntries(): readonly LogEntry[] {
  return entries;
}

export function clearAppLog(): void {
  entries.length = 0;
}