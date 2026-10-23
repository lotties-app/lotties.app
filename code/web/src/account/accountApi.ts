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
}

export const ACCOUNT_DELETION_PREVIEW_KEY = ['account-deletion-preview'] as const;

const previewPath = `${API_PREFIX}/me/deletion-preview`;
const mePath = `${API_PREFIX}/me`;

export function getDeletionPreview(api: ApiClient): Promise<AccountDeletionPreview> {
  return api.request<AccountDeletionPreview>(previewPath);
}

/** Deletes the account on the server; `identityRemoved` says whether the sign-in account is gone too. */
export function deleteAccount(api: ApiClient): Promise<{ identityRemoved: boolean }> {
  return api.request<{ identityRemoved: boolean }>(mePath, { method: 'DELETE' });
}
