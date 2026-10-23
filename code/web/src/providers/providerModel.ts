import type { Appointment, CareProvider } from '../db/models';

/*
 * The baby's directory of care providers on the device (docs/design/22-care-providers.md), pure:
 * limits mirrored from the API's `CareProviderTerms`, the suggested specialties, search and order,
 * the links built from a provider's contact details (phone, WhatsApp, e-mail, website, maps) and
 * what a picked provider copies into an appointment.
 */

export const PROVIDER_LIMITS = {
  name: 80,
  specialty: 60,
  registrationCouncil: 20,
  registrationNumber: 30,
  registrationRegion: 10,
  clinicName: 120,
  address: 400,
  phone: 30,
  whatsapp: 30,
  email: 120,
  website: 200,
  notes: 1000,
} as const;

/** Suggested specialties (codes translated under `providers.specialties.*`); any text is accepted. */
export const SPECIALTY_CODES = [
  'pediatrician',
  'dermatologist',
  'ent',
  'cardiologist',
  'allergist',
  'gastro',
  'ophthalmologist',
  'orthopedist',
  'dentist',
  'other',
] as const;
export type SpecialtyCode = (typeof SPECIALTY_CODES)[number];

/** The state a parent edits; ids, authorship and times are set by the commands. */
export type CareProviderTerms = Pick<
  CareProvider,
  | 'name'
  | 'specialty'
  | 'registrationCouncil'
  | 'registrationNumber'
  | 'registrationRegion'
  | 'clinicName'
  | 'address'
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'website'
  | 'notes'
  | 'favorite'
  | 'deleted'
>;

export function careProviderTermsOf(p: CareProvider): CareProviderTerms {
  return {
    name: p.name,
    specialty: p.specialty,
    registrationCouncil: p.registrationCouncil,
    registrationNumber: p.registrationNumber,
    registrationRegion: p.registrationRegion,
    clinicName: p.clinicName,
    address: p.address,
    phone: p.phone,
    whatsapp: p.whatsapp,
    email: p.email,
    website: p.website,
    notes: p.notes,
    favorite: p.favorite,
    deleted: p.deleted,
  };
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** The providers still on the list (not deleted). */
export function activeProviders(providers: readonly CareProvider[]): CareProvider[] {
  return providers.filter((p) => !p.deleted);
}

/** Favorites first, then by name (accents and case ignored), then by id: the order of every list. */
export function sortProviders(providers: readonly CareProvider[]): CareProvider[] {
  return [...providers].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      fold(a.name).localeCompare(fold(b.name)) ||
      a.id.localeCompare(b.id),
  );
}

/** What a search matches: name, specialty (as typed and as its translated label), clinic, registration. */
function searchText(p: CareProvider, specialtyLabel: string | null): string {
  return fold(
    [
      p.name,
      p.specialty,
      specialtyLabel,
      p.clinicName,
      p.registrationCouncil,
      p.registrationNumber,
      p.address,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * The not-deleted providers matching every word of `query` (an empty query matches all), in list
 * order. `specialtyLabel` translates a stored specialty so "pediatra" finds `pediatrician`.
 */
export function searchProviders(
  providers: readonly CareProvider[],
  query: string,
  specialtyLabel: (specialty: string | null) => string | null = () => null,
): CareProvider[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return sortProviders(activeProviders(providers)).filter((p) => {
    const text = searchText(p, specialtyLabel(p.specialty));
    return words.every((word) => text.includes(word));
  });
}

/** Whether the stored specialty is one of the suggested codes (its label is translated). */
export function specialtyCodeOf(specialty: string | null): SpecialtyCode | null {
  const found = SPECIALTY_CODES.find((code) => code === specialty?.trim().toLowerCase());
  return found ?? null;
}

/** "CRM 123456/SP": council, number and region as typed; `null` when none is filled. */
export function registrationLine(
  p: Pick<CareProvider, 'registrationCouncil' | 'registrationNumber' | 'registrationRegion'>,
): string | null {
  const main = [p.registrationCouncil, p.registrationNumber].filter(Boolean).join(' ');
  const line = p.registrationRegion
    ? main
      ? `${main}/${p.registrationRegion}`
      : p.registrationRegion
    : main;
  return line || null;
}

/** The address on one line (line breaks become commas). */
export function singleLineAddress(address: string | null | undefined): string {
  return (address ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(', ');
}

/** A maps search for the address (or, without one, the clinic name); `null` when neither is set. */
export function mapsUrl(p: Pick<CareProvider, 'address' | 'clinicName'>): string | null {
  const query = singleLineAddress(p.address) || p.clinicName?.trim() || '';
  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}

/** `tel:` with the digits and a leading plus only; `null` when there is no digit. */
export function telUrl(phone: string | null | undefined): string | null {
  const text = phone?.trim() ?? '';
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${text.startsWith('+') ? '+' : ''}${digits}`;
}

/** `https://wa.me/<digits>` (the number needs its country code); `null` when there is no digit. */
export function whatsappUrl(number: string | null | undefined): string | null {
  const digits = number?.replace(/\D/g, '') ?? '';
  return digits ? `https://wa.me/${digits}` : null;
}

/** `mailto:` for a plausible address; `null` otherwise. */
export function mailtoUrl(email: string | null | undefined): string | null {
  const text = email?.trim() ?? '';
  return /^[^\s@]+@[^\s@]+$/.test(text) ? `mailto:${text}` : null;
}

/**
 * An `https:` link for the website. An address without a scheme gets `https://`; one that names
 * another scheme (`javascript:`, `data:`) is never a link.
 */
export function websiteUrl(website: string | null | undefined): string | null {
  const text = website?.trim() ?? '';
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null;
  return `https://${text}`;
}

/** The website as shown: without the scheme and a trailing slash. */
export function websiteLabel(website: string): string {
  return website
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
}

/**
 * What picking a provider copies into the appointment's own text fields: the doctor's name, and
 * the place (clinic, then the address on one line, within the appointment's length limit).
 */
export function appointmentFieldsFrom(p: CareProvider): { doctorName: string; location: string } {
  const place = [p.clinicName?.trim(), singleLineAddress(p.address)].filter(Boolean).join(', ');
  return { doctorName: p.name, location: place.slice(0, 200) };
}

/** The directory entry an appointment links to, if it is still on the device and not deleted. */
export function providerOf(
  appointment: Pick<Appointment, 'providerId'>,
  providers: readonly CareProvider[],
): CareProvider | null {
  if (!appointment.providerId) return null;
  const found = providers.find((p) => p.id === appointment.providerId);
  return found && !found.deleted ? found : null;
}
