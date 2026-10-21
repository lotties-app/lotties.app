import { ApiError } from './ApiError';

const MESSAGES: Record<string, string> = {
  event_type_in_use:
    'This event type is used by logged events, so it cannot be deleted. You can rename it instead.',
  event_type_key_taken: 'An event type with this name already exists. Choose another name.',
  event_type_built_in_read_only: 'Built-in event types cannot be changed.',
  event_type_not_found: 'This event type no longer exists.',
  last_owner_required: 'A baby needs at least one owner. Make someone else an owner first.',
  member_not_found: 'This member is no longer part of the baby.',
  invite_not_found: 'This invite link is not valid. It may have been revoked or mistyped.',
  invite_expired: 'This invite has expired. Ask for a new invite link.',
  invite_already_accepted: 'This invite was already used. Ask for a new invite link.',
  member_already_exists: 'You are already a member of this baby.',
};

export const OFFLINE_MESSAGE = 'You are offline. Connect to the internet to do this.';

/** A user-facing sentence for a failed online operation (known codes, then status, then network). */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const known = error.code ? MESSAGES[error.code] : undefined;
    if (known) return known;
    if (error.status === 403) return 'You do not have permission to do this.';
    const detail = error.problem?.detail ?? error.problem?.title;
    if (error.status >= 400 && error.status < 500 && detail) return detail;
    return 'The server could not complete the request. Try again later.';
  }
  if (error instanceof TypeError) return OFFLINE_MESSAGE;
  return error instanceof Error ? error.message : 'Something went wrong.';
}
