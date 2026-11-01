import { readConfig } from '../config/appConfig';
import { BOARD_PREFIX } from './boardApi';

/*
 * The commands of the API keys panel's "How to use" (docs/KEYCLOAK-BOARD.md): the board's address
 * comes from the API base URL the app is built with (the page's origin when it is the same site).
 * Commands are not translated; the secret is never part of them (a placeholder or a variable).
 */

/** `https://<host>/api/v1/board` of this deployment. */
export function boardApiRoot(
  apiBaseUrl: string | undefined = readApiBaseUrl(),
  origin = window.location.origin,
): string {
  const base = (apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  return `${base || origin}${BOARD_PREFIX}`;
}

function readApiBaseUrl(): string | undefined {
  const result = readConfig();
  return result.ok ? result.config.apiBaseUrl : undefined;
}

/** A read with the key from an environment variable (never typed into the shell history). */
export const curlExample = (root: string) =>
  `curl -s ${root}/summary -H "X-Board-Key: $LOTTIES_BOARD_KEY"`;

/** Claude Code's MCP line for the board endpoint (served once the board MCP route is enabled). */
export const mcpCommand = (root: string) =>
  `claude mcp add --transport http lotties-board ${root}/mcp --header "Authorization: Bearer <key>"`;

/** The prefix of a key as lists show it: `lbk_AbCdEfGh…`. */
export const maskedPrefix = (prefix: string) => `${prefix}…`;
