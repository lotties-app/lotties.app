import type { PersonSummary } from '../db/models';
import { doctorNameOf } from '../notes/noteModel';

/** "Dr. Ana Souza" (pt-BR "Dr(a). Ana Souza"), plus "(no longer has access)" after a removal. */
export function doctorLabel(
  t: (key: 'doctor.name' | 'doctor.nameNoAccess', options: { name: string }) => string,
  person: Pick<PersonSummary, 'displayName' | 'professional'>,
  hasAccess = true,
): string {
  const name = doctorNameOf(person);
  return t(hasAccess ? 'doctor.name' : 'doctor.nameNoAccess', { name });
}
