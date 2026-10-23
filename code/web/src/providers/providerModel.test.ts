import { describe, expect, it } from 'vitest';
import type { CareProvider } from '../db/models';
import {
  activeProviders,
  appointmentFieldsFrom,
  mailtoUrl,
  mapsUrl,
  providerOf,
  registrationLine,
  searchProviders,
  singleLineAddress,
  sortProviders,
  specialtyCodeOf,
  telUrl,
  websiteLabel,
  websiteUrl,
  whatsappUrl,
} from './providerModel';

function provider(id: string, extra: Partial<CareProvider> = {}): CareProvider {
  return {
    id,
    babyId: 'baby-1',
    name: id,
    specialty: null,
    registrationCouncil: null,
    registrationNumber: null,
    registrationRegion: null,
    clinicName: null,
    address: null,
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    notes: null,
    favorite: false,
    deleted: false,
    createdBy: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

describe('listing', () => {
  const list = [
    provider('Zeca'),
    provider('Ana', { favorite: true }),
    provider('Álvaro'),
    provider('Gone', { deleted: true }),
    provider('Bia', { favorite: true, specialty: 'pediatrician', clinicName: 'Clínica Sol' }),
  ];

  it('puts favorites first, then names without regard to accents, and hides deleted ones', () => {
    expect(sortProviders(activeProviders(list)).map((p) => p.name)).toEqual([
      'Ana',
      'Bia',
      'Álvaro',
      'Zeca',
    ]);
  });

  it('searches every word over name, clinic, translated specialty, registration and address', () => {
    const label = (s: string | null) => (s === 'pediatrician' ? 'Pediatra' : s);
    expect(searchProviders(list, '').map((p) => p.name)).toEqual(['Ana', 'Bia', 'Álvaro', 'Zeca']);
    expect(searchProviders(list, 'alvaro').map((p) => p.name)).toEqual(['Álvaro']);
    expect(searchProviders(list, 'pediatra sol', label).map((p) => p.name)).toEqual(['Bia']);
    expect(searchProviders(list, 'clinica', label).map((p) => p.name)).toEqual(['Bia']);
    expect(searchProviders(list, 'gone').map((p) => p.name)).toEqual([]);
  });

  it('knows the suggested specialties by code, case-insensitively', () => {
    expect(specialtyCodeOf('ENT')).toBe('ent');
    expect(specialtyCodeOf('Neurologist')).toBeNull();
    expect(specialtyCodeOf(null)).toBeNull();
  });
});

describe('registration', () => {
  it('reads like CRM 123456/SP with whatever is filled in', () => {
    const base = { registrationCouncil: null, registrationNumber: null, registrationRegion: null };
    expect(
      registrationLine({
        registrationCouncil: 'CRM',
        registrationNumber: '123456',
        registrationRegion: 'SP',
      }),
    ).toBe('CRM 123456/SP');
    expect(registrationLine({ ...base, registrationCouncil: 'CRO', registrationNumber: '9' })).toBe(
      'CRO 9',
    );
    expect(registrationLine({ ...base, registrationRegion: 'RJ' })).toBe('RJ');
    expect(registrationLine(base)).toBeNull();
  });
});

describe('links', () => {
  it('builds a maps search from the address on one line, else the clinic', () => {
    expect(singleLineAddress('Rua A, 1\n\n São Paulo \r\nSP')).toBe('Rua A, 1, São Paulo, SP');
    expect(mapsUrl({ address: 'Rua A, 1\nSão Paulo', clinicName: 'Clinic' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%201%2C%20S%C3%A3o%20Paulo',
    );
    expect(mapsUrl({ address: null, clinicName: 'Clinic Sol' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Clinic%20Sol',
    );
    expect(mapsUrl({ address: ' ', clinicName: null })).toBeNull();
  });

  it('keeps the digits and a leading plus in tel: and wa.me links', () => {
    expect(telUrl('+55 (11) 5555-0000')).toBe('tel:+551155550000');
    expect(telUrl('11 5555-0000')).toBe('tel:1155550000');
    expect(telUrl('call me')).toBeNull();
    expect(whatsappUrl('+55 11 95555-0000')).toBe('https://wa.me/5511955550000');
    expect(whatsappUrl('')).toBeNull();
  });

  it('only links a plausible e-mail', () => {
    expect(mailtoUrl(' ana@clinic.example ')).toBe('mailto:ana@clinic.example');
    expect(mailtoUrl('ana at clinic')).toBeNull();
  });

  it('gives a website https, keeps http(s) and never links another scheme', () => {
    expect(websiteUrl('clinic.example/ana')).toBe('https://clinic.example/ana');
    expect(websiteUrl('HTTP://clinic.example')).toBe('HTTP://clinic.example');
    expect(websiteUrl('localhost:8080/x')).toBe('https://localhost:8080/x');
    expect(websiteUrl('javascript:alert(1)')).toBeNull();
    expect(websiteUrl('data:text/html,x')).toBeNull();
    expect(websiteUrl('  ')).toBeNull();
    expect(websiteLabel('https://clinic.example/')).toBe('clinic.example');
  });
});

describe('with an appointment', () => {
  it('copies the doctor and the place (clinic, then the address on one line, within the limit)', () => {
    const p = provider('Dr. Ana', { clinicName: 'Clinic Sol', address: 'Rua A, 1\nSão Paulo' });
    expect(appointmentFieldsFrom(p)).toEqual({
      doctorName: 'Dr. Ana',
      location: 'Clinic Sol, Rua A, 1, São Paulo',
    });
    expect(appointmentFieldsFrom(provider('Dr. B')).location).toBe('');
    expect(
      appointmentFieldsFrom(provider('Dr. C', { address: 'x'.repeat(400) })).location,
    ).toHaveLength(200);
  });

  it('finds the linked provider unless it is gone or deleted', () => {
    const list = [provider('a'), provider('b', { deleted: true })];
    expect(providerOf({ providerId: 'a' }, list)?.id).toBe('a');
    expect(providerOf({ providerId: 'b' }, list)).toBeNull();
    expect(providerOf({ providerId: 'zzz' }, list)).toBeNull();
    expect(providerOf({ providerId: null }, list)).toBeNull();
    expect(providerOf({}, list)).toBeNull();
  });
});
