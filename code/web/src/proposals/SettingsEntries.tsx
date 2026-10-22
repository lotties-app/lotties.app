import { useTranslation } from 'react-i18next';
import { canDecideProposals, canPropose } from '../baby/permissions';
import type { Baby } from '../db/models';
import { useMembers } from '../now/useMembers';
import { SettingsLinkRow } from '../settings/SettingsLinkRow';
import { useDoctorInbox } from './useProposals';

/** "From your doctor" with its badge, for the Owners and Parents of a baby that has a doctor. */
function FromDoctorEntry({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const inbox = useDoctorInbox(baby);
  const members = useMembers(baby);
  if (!inbox) return null;
  const hasDoctor = members?.some((member) => member.role === 'Doctor') ?? false;
  const anything = inbox.proposals.length > 0 || inbox.recommendations.length > 0;
  if (!hasDoctor && !anything) return null;
  return (
    <SettingsLinkRow
      to="/from-doctor"
      title={t('proposals.fromDoctor.title')}
      badge={inbox.count}
    />
  );
}

/**
 * The settings entries of the doctor's data (docs/design/16-doctor-access.md): Notes (with the
 * unread recommendations as its badge for the Owners and Parents), "From your doctor" for them, and
 * "My proposals" for the Doctor.
 */
export function DoctorSettingsEntries({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const inbox = useDoctorInbox(baby);
  const decides = canDecideProposals(baby);
  return (
    <>
      <SettingsLinkRow
        to="/notes"
        title={t('doctor.notes.title')}
        badge={decides ? (inbox?.unread.length ?? 0) : 0}
      />
      {decides && <FromDoctorEntry baby={baby} />}
      {canPropose(baby) && <SettingsLinkRow to="/proposals" title={t('proposals.mine.title')} />}
    </>
  );
}
