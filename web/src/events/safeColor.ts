const HEX_COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Event type colours come from the server; anything that is not a hex colour is ignored. */
export function safeColor(color: string): string | undefined {
  return HEX_COLOR.test(color) ? color : undefined;
}
