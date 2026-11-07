import type { PersonSummary } from '../db/models';
import { doctorNameOf } from '../notes/noteModel';

type LabelKey = 'doctor.name' | 'doctor.nameNoAccess' | 'doctor.unnamed' | 'doctor.unnamedNoAccess';

/**
 * "Dr. Ana Souza" (pt-BR "Dr(a). Ana Souza"), plus "(no longer has access)" after a removal. A doctor
 * who does not share her name (docs/design/45) is "Doctor (Pediatrics)" by her specialty.
 */
export function doctorLabel(
  t: (key: LabelKey, options: { name: string }) => string,
  person: Pick<PersonSummary, 'displayName' | 'professional'>,
  hasAccess = true,
): string {
  const name = doctorNameOf(person);
  if (!name) {
    const specialty = person.professional?.specialty?.trim() ?? '';
    return t(hasAccess ? 'doctor.unnamed' : 'doctor.unnamedNoAccess', { name: specialty ? ` (${specialty})` : '' });
  }
  return t(hasAccess ? 'doctor.name' : 'doctor.nameNoAccess', { name });
}
