import { describe, expect, it } from 'vitest';
import { scoreCrySignals, type CryReasonResult, type CrySignals } from './cryReasons';
import vectors from './cryReasonsVectors.json';

/*
 * The scoring of "Why is she crying?" is ported to C# (Lotties.Domain.CryReasons.CryReasonRanker,
 * used by the voice assistants). These vectors are run by both: the API's Lotties.Domain.Tests
 * (CryReasonVectorTests) read this same file, so the two implementations stay identical.
 */

/** The result without null members (the C# side leaves them out). */
const withoutNulls = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, member) => (member === null ? undefined : member)));

describe('cry reasons shared vectors', () => {
  it('has cases', () => {
    expect(vectors.cases.length).toBeGreaterThan(20);
  });

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, vector) => {
    const result: CryReasonResult = scoreCrySignals(vector.signals as CrySignals);
    expect(withoutNulls(result)).toEqual(withoutNulls(vector.expected));
  });
});
