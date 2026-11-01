import { describe, expect, it } from 'vitest';
import type { BabyRole } from '../db/models';
import { canDecideProposals, canPropose, canWrite } from './permissions';

/* Who proposes and who decides (docs/design/16-doctor-access.md section 10). */

const ROLES: readonly BabyRole[] = ['Owner', 'Parent', 'Caregiver', 'Viewer', 'Doctor'];

describe('proposal permissions', () => {
  it.each(ROLES)('lets only the Doctor propose (%s)', (role) => {
    expect(canPropose({ role })).toBe(role === 'Doctor');
  });

  it.each(ROLES)('lets only Owners and Parents decide (%s)', (role) => {
    expect(canDecideProposals({ role })).toBe(role === 'Owner' || role === 'Parent');
  });

  it('never gives the Doctor a write on the baby data', () => {
    expect(canWrite({ role: 'Doctor' })).toBe(false);
    expect(canPropose({ role: 'Doctor' }) && canDecideProposals({ role: 'Doctor' })).toBe(false);
  });
});
