import fs from 'node:fs';

/** Variables the suite needs; anything else in the file (migrator, read-only roles) is ignored. */
const ALLOWED = [
  /^DB_(HOST|PORT|NAME|APP_USER|APP_PASSWORD)$/,
  /^AUTH_/,
  /^CORS_ALLOWED_ORIGINS$/,
  /^VITE_OIDC_/,
  /^E2E_/,
];

function parseValue(rawValue: string): string {
  const value = rawValue.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end > 0) return value.slice(1, end);
  }
  // Like docker compose: `#` only starts a comment after whitespace, so passwords may contain it.
  const comment = value.search(/\s#/);
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

/**
 * Loads the repo's gitignored root `.env` into `process.env` without printing anything. Values
 * already present in the environment (CI secrets) win. Not `dotenv`: it treats an unquoted `#`
 * inside a value as a comment, which silently truncates passwords.
 */
export function loadRootEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match || !ALLOWED.some((pattern) => pattern.test(match[1]))) continue;
    if (process.env[match[1]] === undefined) process.env[match[1]] = parseValue(match[2]);
  }
}
