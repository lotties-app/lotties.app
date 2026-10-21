/** Shareable URL of an invite token (opened by `/invite/:token`). */
export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}
