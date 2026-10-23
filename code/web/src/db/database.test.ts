import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSIONS } from './database';

describe('SCHEMA_VERSIONS', () => {
  it('numbers the versions 1, 2, 3, ... strictly increasing, with no gap and no duplicate', () => {
    // Two branches that both appended a version end up with the same number: on integration the
    // branch merged second renumbers its entry to the next free number (docs/PROCESS.md).
    expect(SCHEMA_VERSIONS.map(({ version }) => version)).toEqual(
      SCHEMA_VERSIONS.map((_, index) => index + 1),
    );
  });
});
