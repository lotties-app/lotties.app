const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of a UTC ISO timestamp, as `yyyy-mm-dd`. */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
