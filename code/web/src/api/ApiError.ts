/** RFC 7807 problem details as returned by the API (`application/problem+json`). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  /** Stable domain error code (API extension), e.g. `event_baby_mismatch`. */
  code?: string;
  /** Offending input field for validation problems (API extension). */
  field?: string;
  /** Import error extensions (API): size limits and the offending medication tokens. */
  maxBytes?: number;
  maxRows?: number;
  /** Medication-name import limit (API extension, `import_too_many_medication_names`). */
  maxNames?: number;
  token?: string;
  tokens?: string[];
  /** Backup import extensions (API): the schema versions of `backup_unsupported_version`, the limit of `backup_too_large`, the count of `backup_rejected`. */
  schemaVersion?: number;
  maxSupported?: number;
  max?: number;
  issueCount?: number;
  /** The existing catalog product of a 409 `product_exists` (API extension). */
  product?: unknown;
}

function asProblem(body: unknown): ProblemDetails | null {
  return typeof body === 'object' && body !== null ? (body as ProblemDetails) : null;
}

/**
 * The `Retry-After` header of an answer in whole milliseconds from now (delta seconds or an HTTP
 * date, RFC 9110 section 10.2.3); `null` when absent or unreadable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** How long the server asked to wait before retrying (`Retry-After`), in ms; `null` when it did not say. */
  readonly retryAfterMs: number | null;

  constructor(status: number, body: unknown, message?: string, retryAfterMs: number | null = null) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }

  /** The problem details body, when the server sent a JSON object. */
  get problem(): ProblemDetails | null {
    return asProblem(this.body);
  }

  /** The stable domain error `code` from the problem details, if any. */
  get code(): string | null {
    const code = this.problem?.code;
    return typeof code === 'string' && code ? code : null;
  }
}
