/*
 * Safe access to plain-object records keyed by strings that come from the server or from user
 * data (field keys, icon names, problem codes, medication tokens). A bare `record[key]` also
 * finds inherited members such as `constructor` or `__proto__`, and an assignment to
 * `record['__proto__']` changes the prototype instead of storing a value.
 */

/** The record's own value for `key`, or `undefined` (never an inherited member). */
export function getOwn<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Stores `value` as an own, enumerable property, also for keys such as `__proto__`. */
export function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** A shallow copy of `record` with `key` set to `value` (safe for any key). */
export function withOwn<T>(record: Readonly<Record<string, T>>, key: string, value: T) {
  const copy: Record<string, T> = { ...record };
  setOwn(copy, key, value);
  return copy;
}

/** A shallow copy of `record` without `key`. */
export function withoutOwn<T>(record: Readonly<Record<string, T>>, key: string) {
  const copy: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) if (k !== key) setOwn(copy, k, v);
  return copy;
}
