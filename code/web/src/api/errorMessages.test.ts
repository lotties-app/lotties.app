import { describe, expect, it } from 'vitest';
import { ApiError } from './ApiError';
import { describeApiError } from './errorMessages';

const RATE_LIMITED = 'Too many requests, please wait a moment.';
const TOO_LARGE = 'The data is too large to send. Try a smaller change.';

describe('describeApiError', () => {
  it('maps concurrent_modification, rate_limited and request_body_too_large', () => {
    expect(describeApiError(new ApiError(409, { code: 'concurrent_modification' }))).toBe(
      'Something changed at the same time, please try again.',
    );
    expect(describeApiError(new ApiError(429, { code: 'rate_limited' }))).toBe(RATE_LIMITED);
    expect(describeApiError(new ApiError(413, { code: 'request_body_too_large' }))).toBe(TOO_LARGE);
  });

  it('falls back to the status for rate limits and oversized bodies without a code', () => {
    expect(describeApiError(new ApiError(429, {}))).toBe(RATE_LIMITED);
    expect(describeApiError(new ApiError(413, {}))).toBe(TOO_LARGE);
  });

  it('names the medication-name limit from the problem', () => {
    const error = new ApiError(400, { code: 'import_too_many_medication_names', maxNames: 50 });
    expect(describeApiError(error)).toContain('more than 50 different medication names');
  });
});
