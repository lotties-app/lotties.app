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
}

export const ASSISTANT_SETTINGS_KEY = ['assistant-settings'] as const;

const settingsPath = `${API_PREFIX}/me/assistant-settings`;

export function getAssistantSettings(api: ApiClient): Promise<AssistantSettings> {
  return api.request<AssistantSettings>(settingsPath);
}

/** Saves the default baby (`null` clears it); the server accepts only a baby the user can log for. */
export function saveAssistantSettings(
  api: ApiClient,
  defaultBabyId: string | null,
): Promise<AssistantSettings> {
  return api.request<AssistantSettings>(settingsPath, { method: 'PUT', body: { defaultBabyId } });
}
