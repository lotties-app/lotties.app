import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole, CareProvider } from '../db/models';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { ProvidersScreen } from './ProvidersScreen';

/*
 * "Doctors and clinics" (docs/design/22-care-providers.md): the list with search and favorites
 * first, the detail with its contact links, add / edit / favorite / delete with Undo, the empty
 * state and the read-only roles.
 */

let db: BabyRoutineDb;

function provider(id: string, extra: Partial<CareProvider> = {}): CareProvider {
  return {
    id,
    babyId: BABY_ID,
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
    createdBy: 'u1',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

const SEEDED: CareProvider[] = [
  provider('Dr. Ana Lima', {
    specialty: 'pediatrician',
    registrationCouncil: 'CRM',
    registrationNumber: '123456',
    registrationRegion: 'SP',
    clinicName: 'Clinic Sol',
    address: 'Rua das Flores, 10\nSao Paulo',
    phone: '+55 11 5555-0000',
    whatsapp: '+55 11 95555-0000',
    email: 'ana@clinic.example',
    website: 'clinic.example/ana',
    notes: 'Prefers mornings',
    favorite: true,
  }),
  provider('Dr. Caio Dias', { specialty: 'Neurology' }),
  provider('Dra. Bia', { specialty: 'dermatologist' }),
  provider('Gone', { deleted: true }),
];

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

async function renderScreen(role: BabyRole = 'Owner', list: CareProvider[] = SEEDED) {
  await db.careProviders.bulkPut(list);
  renderWithDb(
    db,
    <>
      <ProvidersScreen baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role }} />
      <UndoSnackbar />
    </>,
  );
}

const names = () =>
  within(screen.getByRole('list', { name: /Doctors and clinics|Médicos e clínicas/ }))
    .getAllByRole('button')
    .map((row) => row.textContent);

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe('the list', () => {
  it('shows favorites first, then by name, with the specialty and clinic, and no deleted ones', async () => {
    await renderScreen();

    await screen.findByRole('list', { name: 'Doctors and clinics' });
    const rows = names();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Dr. Ana Lima');
    expect(rows[0]).toContain('Pediatrician · Clinic Sol · CRM 123456/SP');
    expect(rows[1]).toContain('Dr. Caio Dias');
    expect(rows[1]).toContain('Neurology');
    expect(rows[2]).toContain('Dra. Bia');
    expect(screen.queryByText('Gone')).toBeNull();
    expect(screen.getByRole('img', { name: 'Favorite' })).toBeTruthy();
  });

  it('searches by name, clinic, translated specialty and registration, and says when nothing matches', async () => {
    await renderScreen();
    const search = await screen.findByRole('searchbox', { name: 'Search doctors and clinics' });

    fireEvent.change(search, { target: { value: 'dermato' } });
    expect(names()).toEqual([expect.stringContaining('Dra. Bia')]);
    fireEvent.change(search, { target: { value: 'sol 123456' } });
    expect(names()).toEqual([expect.stringContaining('Dr. Ana Lima')]);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'No doctor or clinic matches "zzz".',
    );
  });

  it('explains the benefit when the directory is empty', async () => {
    await renderScreen('Owner', []);

    expect(
      await screen.findByRole('heading', { name: "Your baby's doctors, in one place" }),
    ).toBeTruthy();
    expect(screen.getByText(/pick one and the doctor and place fill in on their own/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add doctor or clinic' })).toBeTruthy();
  });
});

describe('the detail', () => {
  it('shows the registration and the contact as links', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Dr. Ana Lima/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Dr. Ana Lima' });

    expect(within(sheet).getByText('CRM 123456/SP')).toBeTruthy();
    const link = (name: RegExp) => within(sheet).getByRole('link', { name });
    expect(link(/Call/).getAttribute('href')).toBe('tel:+551155550000');
    expect(link(/Message on WhatsApp/).getAttribute('href')).toBe('https://wa.me/5511955550000');
    expect(link(/Send an e-mail/).getAttribute('href')).toBe('mailto:ana@clinic.example');
    expect(link(/Open the website/).getAttribute('href')).toBe('https://clinic.example/ana');
    expect(link(/Open in maps/).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Rua%20das%20Flores%2C%2010%2C%20Sao%20Paulo',
    );
    expect(link(/Open in maps/).getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(sheet).getByText(/Rua das Flores, 10/)).toBeTruthy();
    expect(within(sheet).getByText('Prefers mornings')).toBeTruthy();
  });

  it('never makes a link out of a website with another scheme', async () => {
    await renderScreen('Owner', [provider('Odd', { website: 'javascript:alert(1)' })]);

    fireEvent.click(await screen.findByRole('button', { name: /Odd/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Odd' });

    expect(within(sheet).queryByRole('link')).toBeNull();
  });
});

describe('adding and changing', () => {
  it('adds a provider with a suggested specialty stored by code and queues the upsert', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Add doctor or clinic' }));
    const sheet = await screen.findByRole('dialog', { name: 'New doctor or clinic' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Enter a name of up to 80 characters.')).toBeTruthy();

    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Dr. Eva' },
    });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'ENT' }));
    expect(within(sheet).getByRole('textbox', { name: /^Specialty/ })).toHaveProperty(
      'value',
      'ENT',
    );
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Council/ }), {
      target: { value: 'CRM' },
    });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Phone/ }), {
      target: { value: '11 4444-0000' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const stored = (await db.careProviders.toArray()).find((p) => p.name === 'Dr. Eva');
    expect(stored).toMatchObject({
      specialty: 'ent',
      registrationCouncil: 'CRM',
      phone: '11 4444-0000',
      favorite: false,
    });
    expect((await db.outbox.toArray()).map((m) => m.entityType)).toEqual(['careProvider']);
  });

  it('edits a provider and keeps free-text specialties as typed', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Dr. Caio Dias/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit doctor or clinic' });
    expect(within(sheet).getByRole('textbox', { name: /^Specialty/ })).toHaveProperty(
      'value',
      'Neurology',
    );
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Dr. Caio Dias Jr' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () =>
      expect(await db.careProviders.get('Dr. Caio Dias')).toMatchObject({
        name: 'Dr. Caio Dias Jr',
        specialty: 'Neurology',
      }),
    );
  });

  it('marks a favorite and deletes with Undo', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Dra. Bia/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as favorite' }));
    await waitFor(async () =>
      expect((await db.careProviders.get('Dra. Bia'))?.favorite).toBe(true),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from favorites' }));
    await waitFor(async () =>
      expect((await db.careProviders.get('Dra. Bia'))?.favorite).toBe(false),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await db.careProviders.get('Dra. Bia'))?.deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText('Dra. Bia', { selector: 'span' })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect((await db.careProviders.get('Dra. Bia'))?.deleted).toBe(false),
    );
  });
});

describe('read-only roles', () => {
  it.each(['Caregiver', 'Viewer'] as const)(
    'a %s reads the directory without dead buttons',
    async (role) => {
      await renderScreen(role);

      await screen.findByRole('list', { name: 'Doctors and clinics' });
      expect(screen.queryByRole('button', { name: 'Add doctor or clinic' })).toBeNull();
      expect(
        screen.getByText('You can see the doctors and clinics but not change them.'),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Dr. Ana Lima/ }));
      const sheet = await screen.findByRole('dialog', { name: 'Dr. Ana Lima' });
      expect(within(sheet).getByRole('link', { name: /Call/ })).toBeTruthy();
      for (const name of ['Edit', 'Delete', 'Remove from favorites', 'Mark as favorite']) {
        expect(within(sheet).queryByRole('button', { name })).toBeNull();
      }
    },
  );
});

describe('pt-BR', () => {
  it('reads the specialty and the actions in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await renderScreen();

    expect(
      await screen.findByRole('searchbox', { name: 'Buscar médicos e clínicas' }),
    ).toBeTruthy();
    const first = names()[0]!;
    expect(first).toContain('Pediatra · Clinic Sol');
    fireEvent.click(screen.getByRole('button', { name: /Dr. Ana Lima/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Dr. Ana Lima' });
    expect(within(sheet).getByRole('link', { name: /Ligar/ })).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: /Abrir no mapa/ })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Excluir' })).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('doctors and clinics in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, with the detail and the sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await renderScreen();
      await screen.findByRole('list', { name: /Doctors and clinics|Médicos e clínicas/ });
      expect(await violations()).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: /Dr. Ana Lima/ }));
      await screen.findByRole('dialog', { name: 'Dr. Ana Lima' });
      expect(await violations()).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Edit' : 'Editar' }));
      await screen.findByRole('dialog', {
        name: locale === 'en' ? 'Edit doctor or clinic' : 'Editar médico ou clínica',
      });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
