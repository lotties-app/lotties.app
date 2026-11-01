import { canDecideProposals } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useMembers } from '../now/useMembers';
import { patientBabies } from '../patients/patientsModel';
import { isNativeApp } from '../platform/nativeApp';
import { useDoctorInbox } from '../proposals/useProposals';
import type { HubContext } from './hubEntries';

const NO_BABY = { id: '', userId: undefined } as const;

/** What the Hub's visibility rules need, gathered from the selected baby and the local data. */
export function useHubContext(): HubContext | undefined {
  const { babies, baby } = useSelectedBaby();
  const inbox = useDoctorInbox(baby ?? NO_BABY);
  // Without a baby the members query must not run: the Doctor role switches it off.
  const members = useMembers(baby ?? { id: '', role: 'Doctor' });
  if (!babies) return undefined;
  const hasDoctor = members?.some((member) => member.role === 'Doctor') ?? false;
  const anything = !!inbox && (inbox.proposals.length > 0 || inbox.recommendations.length > 0);
  return {
    baby,
    hasPatients: patientBabies(babies).length > 0,
    hasDoctorContent: !!baby && canDecideProposals(baby) && (hasDoctor || anything),
    native: isNativeApp(),
  };
}
