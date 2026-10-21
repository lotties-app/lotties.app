/**
 * Shareable URL of an invite token. The token sits in the URL fragment, which browsers never send
 * to servers or proxies, so it stays out of access logs (the route is `/invite#<token>`).
 */
export function inviteLink(token: string): string {
  return `${window.location.origin}/invite#${token}`;
}
