import { canDecideProposals } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useBabies } from '../db/hooks';
import { hasPatients } from '../doctor/appMode';
import { useMembers } from '../now/useMembers';
import { isNativeApp } from '../platform/nativeApp';
import { useInstallState } from '../install/useInstallState';
import { useDoctorInbox } from '../proposals/useProposals';
import type { HubContext } from './hubEntries';

const NO_BABY = { id: '', userId: undefined } as const;

/** What the Hub's visibility rules need, gathered from the selected baby and the local data. */
export function useHubContext(): HubContext | undefined {
  const { babies, baby } = useSelectedBaby();
  // The selection holds the family's babies only: patients are counted from every membership.
  const all = useBabies();
  const inbox = useDoctorInbox(baby ?? NO_BABY);
  // Without a baby the members query must not run: the Doctor role switches it off.
  const members = useMembers(baby ?? { id: '', role: 'Doctor' });
  const { installed } = useInstallState();
  if (!babies || !all) return undefined;
  const hasDoctor = members?.some((member) => member.role === 'Doctor') ?? false;
  const anything = !!inbox && (inbox.proposals.length > 0 || inbox.recommendations.length > 0);
  return {
    baby,
    hasPatients: hasPatients(all),
    hasDoctorContent: !!baby && canDecideProposals(baby) && (hasDoctor || anything),
    native: isNativeApp(),
    installed,
  };
}
