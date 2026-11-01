import type { BabyEvent } from '../db/models';
import { getOwn } from '../util/ownProperty';

/*
 * The origin marker of the voice and AI assistants (docs/design/32-assistants.md "Origin marker"):
 * an event an assistant command created carries `via` (the adapter name: `alexa`, `siri` or `mcp`), one it
 * stopped that another origin created carries `updated_via`, and one the assistant asked to delete
 * carries `delete_requested_via` and `delete_requested_at` (docs/design/32-assistants.md "Assistants
 * never delete"). Plain payload members no field declares: the editor keeps them, backups and sync
 * carry them. Pure and language-free; members are read as own properties only.
 */

export const VIA_KEY = 'via';
export const UPDATED_VIA_KEY = 'updated_via';
export const DELETE_REQUESTED_VIA_KEY = 'delete_requested_via';
export const DELETE_REQUESTED_AT_KEY = 'delete_requested_at';

/** The members an edit of the entry must keep. */
export const ASSISTANT_KEYS: readonly string[] = [
  VIA_KEY,
  UPDATED_VIA_KEY,
  DELETE_REQUESTED_VIA_KEY,
  DELETE_REQUESTED_AT_KEY,
];

/** How the sentences name an origin: Alexa, Siri, or any other adapter as "an AI assistant". */
export type AssistantOrigin = 'alexa' | 'siri' | 'assistant';

const originOf = (value: unknown): AssistantOrigin | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value === 'alexa' || value === 'siri' ? value : 'assistant';
};

/** Who created the entry, when an assistant did. */
export function createdVia(event: Pick<BabyEvent, 'payload'>): AssistantOrigin | null {
  return originOf(getOwn(event.payload, VIA_KEY));
}

/** Who changed (stopped) an entry another origin created, when an assistant did. */
export function updatedVia(event: Pick<BabyEvent, 'payload'>): AssistantOrigin | null {
  return originOf(getOwn(event.payload, UPDATED_VIA_KEY));
}

/** Who asked to delete the entry, while the request is open. */
export function deleteRequestedVia(event: Pick<BabyEvent, 'payload'>): AssistantOrigin | null {
  return originOf(getOwn(event.payload, DELETE_REQUESTED_VIA_KEY));
}

/** The payload without the delete request ("Keep"). */
export function withoutDeleteRequest(
  payload: Readonly<BabyEvent['payload']>,
): BabyEvent['payload'] {
  const kept: BabyEvent['payload'] = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== DELETE_REQUESTED_VIA_KEY && key !== DELETE_REQUESTED_AT_KEY) kept[key] = value;
  }
  return kept;
}
