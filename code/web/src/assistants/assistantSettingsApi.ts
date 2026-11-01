import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';

/*
 * The user's voice assistant settings (docs/design/32-assistants.md): the baby Alexa and the MCP
 * server log and answer for when the user can log for several. Online only.
 */

/**
 * `GET`/`PUT /me/assistant-settings`: `updatedAt` is `null` before the first save. `mcpEnabled` and
 * `mcpUrl` say whether the server offers the MCP server for AI assistants and the URL to paste into
 * one (absent from an older server: treated as off).
 */
export interface AssistantSettings {
  defaultBabyId: string | null;
  updatedAt: string | null;
  mcpEnabled?: boolean;
  mcpUrl?: string | null;
  /** Whether answers may say the baby's name; `false` (or absent, from an older server) by default. */
  sayBabyName?: boolean;
  /** Whether answers may say the names of the family's medicines; `false` (or absent) by default. */
  sayMedicineNames?: boolean;
}

export const ASSISTANT_SETTINGS_KEY = ['assistant-settings'] as const;

const settingsPath = `${API_PREFIX}/me/assistant-settings`;

export function getAssistantSettings(api: ApiClient): Promise<AssistantSettings> {
  return api.request<AssistantSettings>(settingsPath);
}

/**
 * Saves the default baby (`null` clears it; the server accepts only a baby the user can log for)
 * and, when given, whether answers may say the baby's name and the names of the medicines. A member
 * left out keeps the stored value.
 */
export function saveAssistantSettings(
  api: ApiClient,
  defaultBabyId: string | null,
  sayBabyName?: boolean,
  sayMedicineNames?: boolean,
): Promise<AssistantSettings> {
  return api.request<AssistantSettings>(settingsPath, {
    method: 'PUT',
    body: {
      defaultBabyId,
      ...(sayBabyName === undefined ? {} : { sayBabyName }),
      ...(sayMedicineNames === undefined ? {} : { sayMedicineNames }),
    },
  });
}
