import { describe, expect, it } from 'vitest';
import { httpError, networkError } from '../test/fakeApi';
import { backoffDelay } from './backoff';
import { classifyFailure } from './failures';

describe('classifyFailure', () => {
  it.each([
    [401, 'unauthorized'],
    [408, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [503, 'transient'],
    [400, 'permanent'],
    [403, 'permanent'],
    [404, 'permanent'],
    [409, 'permanent'],
    [422, 'permanent'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(classifyFailure(httpError(status))).toBe(kind);
  });

  it('treats fetch failures and timeouts as network errors', () => {
    expect(classifyFailure(networkError())).toBe('network');
    expect(classifyFailure(new DOMException('timed out', 'TimeoutError'))).toBe('network');
  });

  it('retries unexpected errors with backoff', () => {
    expect(classifyFailure(new Error('weird'))).toBe('transient');
  });
});

describe('backoffDelay', () => {
  const options = { baseMs: 1_000, maxMs: 10_000 };

  it('doubles the ceiling per attempt with jitter in [ceiling/2, ceiling)', () => {
    const low = { ...options, random: () => 0 };
    const high = { ...options, random: () => 0.999 };
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, low))).toEqual([500, 1_000, 2_000, 4_000]);
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, high))).toEqual([999, 1_999, 3_998, 7_996]);
  });

  it('caps the delay at maxMs', () => {
    expect(backoffDelay(20, { ...options, random: () => 0.999 })).toBeLessThanOrEqual(10_000);
    expect(backoffDelay(20, { ...options, random: () => 0 })).toBe(5_000);
  });
});
