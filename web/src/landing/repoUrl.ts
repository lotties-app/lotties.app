/** The source repository link of the footer: `VITE_REPO_URL`, only when it is a web address. */
export function repoUrl(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): string | null {
  const value = env.VITE_REPO_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
