import type { EventPayload, EventType } from '../../db/models';
import { getOwn } from '../../util/ownProperty';

/**
 * The illustration key of an event: sleep kinds and feeding methods pick their own drawing, the
 * other built-in types use the type key, and a custom type has none (`''`: `Illustration` then
 * shows the fallback tile with the type's own icon). Payload keys come from the server, so they are read with `getOwn`.
 */
export function illustrationKeyFor(
  type: Pick<EventType, 'key' | 'babyId'> | undefined,
  payload: EventPayload = {},
): string {
  if (!type || type.babyId !== null) return '';
  const pick = (field: string) => {
    const value = getOwn(payload, field);
    return typeof value === 'string' ? value : undefined;
  };
  if (type.key === 'sleep') return pick('kind') ?? 'nap';
  if (type.key === 'feeding') return pick('method') ?? 'bottle';
  return type.key;
}
