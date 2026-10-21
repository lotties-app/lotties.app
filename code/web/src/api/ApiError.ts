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
  /** The existing catalog product of a 409 `product_exists` (API extension). */
  product?: unknown;
}

function asProblem(body: unknown): ProblemDetails | null {
  return typeof body === 'object' && body !== null ? (body as ProblemDetails) : null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
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
