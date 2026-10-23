/** Only web addresses become links (the data files are ours, but the check is cheap). */
export function isWebAddress(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}
