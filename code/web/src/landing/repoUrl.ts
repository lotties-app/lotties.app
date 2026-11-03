type Env = Record<string, string | undefined>;

/** `value` as a web address (http or https only), or `null` when it is empty or anything else. */
export function webAddress(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The source repository link of the footer: `VITE_REPO_URL`, only when it is a web address. */
export function repoUrl(env: Env = import.meta.env as Env): string | null {
  return webAddress(env.VITE_REPO_URL);
}
