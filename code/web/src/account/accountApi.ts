import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';

/** A baby named in the deletion preview. */
export interface AccountDeletionBaby {
  id: string;
  name: string;
}

/** What `DELETE /me` will do: babies erased, babies kept for the other members, babies in the way. */
export interface AccountDeletionPreview {
  deletedBabies: AccountDeletionBaby[];
  sharedBabies: AccountDeletionBaby[];
  blockedBabies: AccountDeletionBaby[];
  canDelete: boolean;
  /**
   * Whether the server will delete the sign-in account at the identity provider too (its admin
   * client is configured). Absent (an older server) counts as `false`.
   */
  identityRemovable?: boolean;
  /**
   * The babies among `deletedBabies` whose records (or a copy left by a move) are in the user's
   * own database. Absent (an older server) counts as none.
   */
  ownDatabaseBabies?: AccountDeletionBaby[];
}

/** What happened to the sign-in account: removed, not managed by this server, or the provider failed. */
export type IdentityRemoval = 'removed' | 'not_configured' | 'failed';

/** `DELETE /me`: the data is always erased by then; `identity` (newer servers) says what happened to the sign-in account. */
export interface AccountDeletionResult {
  identityRemoved: boolean;
  identity?: IdentityRemoval;
  /** With `wipeOwnDatabase`: the babies whose records in the user's own database were deleted. */
  ownDatabaseWiped?: string[];
  /** With `wipeOwnDatabase`: the babies whose records in the user's own database could not be deleted (it was unreachable). */
  ownDatabaseNotWiped?: string[];
}

/** What to do with the records in the user's own database; off unless she ticks the box. */
export interface AccountDeletionOptions {
  wipeOwnDatabase: boolean;
}

/** The sign-in account outcome, also for a server that sends only `identityRemoved`. */
export function identityOutcome(result: AccountDeletionResult): IdentityRemoval {
  if (result.identity === 'removed' || result.identity === 'failed') return result.identity;
  return result.identityRemoved ? 'removed' : 'not_configured';
}

export const ACCOUNT_DELETION_PREVIEW_KEY = ['account-deletion-preview'] as const;

const previewPath = `${API_PREFIX}/me/deletion-preview`;
const mePath = `${API_PREFIX}/me`;

export function getDeletionPreview(api: ApiClient): Promise<AccountDeletionPreview> {
  return api.request<AccountDeletionPreview>(previewPath);
}

/**
 * Deletes the account on the server; the result says whether the sign-in account is gone too and,
 * when asked to, which babies' records in her own database were or could not be deleted.
 */
export function deleteAccount(
  api: ApiClient,
  options: AccountDeletionOptions = { wipeOwnDatabase: false },
): Promise<AccountDeletionResult> {
  const path = options.wipeOwnDatabase ? `${mePath}?wipeOwnDatabase=true` : mePath;
  return api.request<AccountDeletionResult>(path, { method: 'DELETE' });
}
