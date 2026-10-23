import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentsScreen } from '../appointments/AppointmentsScreen';
import type { BabyRoutineDb } from '../db/database';
import type { Appointment, CareProvider } from '../db/models';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';

/*
 * The care provider picker in the appointment form and the saved doctor in the appointment detail
 * (docs/design/22-care-providers.md): picking fills the doctor and the place, the text stays
 * editable without touching the provider, "Add new provider" creates and selects one inline,
 * removing the link keeps the text, and deleting a provider keeps the old appointments' text.
 */

let db: BabyRoutineDb;

/** Thursday 22 October 2026, 10:00 local. */
const NOW = new Date(2026, 9, 22, 10, 0).getTime();
const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();

const ANA: CareProvider = {
  id: 'ana',
  babyId: BABY_ID,
  name: 'Dr. Ana Lima',
  specialty: 'pediatrician',
  registrationCouncil: 'CRM',
  registrationNumber: '123456',
  registrationRegion: 'SP',
  clinicName: 'Clinic Sol',
  address: 'Rua das Flores, 10\nSao Paulo',
  phone: '+55 11 5555-0000',
  whatsapp: null,
  email: null,
  website: null,
  notes: null,
  favorite: true,
  deleted: false,
  createdBy: 'u1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const BIA: CareProvider = {
  ...ANA,
  id: 'bia',
  name: 'Dra. Bia Costa',
  specialty: 'dermatologist',
  favorite: false,
  clinicName: null,
  address: null,
  phone: null,
};

function appointment(extra: Partial<Appointment> = {}): Appointment {
  return {
    id: 'visit',
    babyId: BABY_ID,
    title: 'Checkup',
    type: 'consultation',
    startsAt: local(24, 15),
    durationMinutes: null,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdBy: 'u1',
    createdAt: local(1, 9),
    updatedAt: local(1, 9),
    ...extra,
  };
}

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

async function renderScreen(providers: CareProvider[], appointments: Appointment[] = []) {
  await db.careProviders.bulkPut(providers);
  await db.appointments.bulkPut(appointments);
  renderWithDb(
    db,
    <AppointmentsScreen
      baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' }}
      initialNow={NOW}
    />,
  );
  await screen.findByRole('grid');
}

const doctorBox = (sheet: HTMLElement) =>
  within(sheet).getByRole('textbox', { name: /^Doctor(?! or)/ });
const placeBox = (sheet: HTMLElement) => within(sheet).getByRole('textbox', { name: /^Place/ });

describe('picking a saved doctor', () => {
  it('lists the saved ones, favorites first, and a pick fills the doctor and the place', async () => {
    await renderScreen([BIA, ANA]);

    fireEvent.click(screen.getAllByRole('button', { name: 'New appointment' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    await within(sheet).findByRole('button', { name: 'Add new provider' });
    const results = within(sheet).getByRole('list', { name: 'Saved doctors and clinics' });
    expect(
      within(results)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining('Dr. Ana Lima · Pediatrician'),
      expect.stringContaining('Dra. Bia Costa · Dermatologist'),
    ]);
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Title/ }), {
      target: { value: 'Checkup' },
    });
    fireEvent.click(within(results).getByRole('button', { name: /Dr. Ana Lima/ }));

    expect(doctorBox(sheet)).toHaveProperty('value', 'Dr. Ana Lima');
    expect(placeBox(sheet)).toHaveProperty('value', 'Clinic Sol, Rua das Flores, 10, Sao Paulo');
    expect(
      within(sheet).getByRole('button', { name: 'Remove the link to Dr. Ana Lima' }),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () =>
      expect((await db.appointments.toArray())[0]).toMatchObject({
        providerId: 'ana',
        doctorName: 'Dr. Ana Lima',
        location: 'Clinic Sol, Rua das Flores, 10, Sao Paulo',
      }),
    );
    expect((await db.outbox.toArray())[0]?.payload).toMatchObject({ providerId: 'ana' });
  });

  it('searches the saved doctors', async () => {
    await renderScreen([BIA, ANA]);

    fireEvent.click(screen.getAllByRole('button', { name: 'New appointment' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    await within(sheet).findByRole('button', { name: 'Add new provider' });
    fireEvent.change(within(sheet).getByRole('searchbox', { name: 'Search saved doctors' }), {
      target: { value: 'derma' },
    });

    const results = within(sheet).getByRole('list', { name: 'Saved doctors and clinics' });
    expect(within(results).getAllByRole('button')).toHaveLength(1);
    fireEvent.change(within(sheet).getByRole('searchbox', { name: 'Search saved doctors' }), {
      target: { value: 'nobody' },
    });
    expect(within(sheet).getByText('No saved doctor matches.')).toBeTruthy();
  });

  it('keeps the text editable and editing it never rewrites the provider', async () => {
    await renderScreen([ANA]);

    fireEvent.click(screen.getAllByRole('button', { name: 'New appointment' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    await within(sheet).findByRole('button', { name: 'Add new provider' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Title/ }), {
      target: { value: 'Checkup' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /Dr. Ana Lima/ }));
    fireEvent.change(doctorBox(sheet), { target: { value: 'Dr. Ana (covering)' } });
    fireEvent.change(placeBox(sheet), { target: { value: 'Annex' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () =>
      expect((await db.appointments.toArray())[0]).toMatchObject({
        providerId: 'ana',
        doctorName: 'Dr. Ana (covering)',
        location: 'Annex',
      }),
    );
    expect(await db.careProviders.get('ana')).toEqual(ANA);
    expect((await db.outbox.toArray()).map((m) => m.entityType)).toEqual(['appointment']);
  });

  it('removes the link but keeps the copied text', async () => {
    await renderScreen([ANA]);

    fireEvent.click(screen.getAllByRole('button', { name: 'New appointment' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    await within(sheet).findByRole('button', { name: 'Add new provider' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Title/ }), {
      target: { value: 'Checkup' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /Dr. Ana Lima/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove the link to Dr. Ana Lima' }));

    expect(doctorBox(sheet)).toHaveProperty('value', 'Dr. Ana Lima');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await db.appointments.toArray())[0]).toMatchObject({
        providerId: null,
        doctorName: 'Dr. Ana Lima',
      }),
    );
  });
});

describe('adding a provider from the form', () => {
  it('creates one inline, selects it and fills the appointment', async () => {
    await renderScreen([]);

    fireEvent.click(screen.getAllByRole('button', { name: 'New appointment' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    await within(sheet).findByRole('button', { name: 'Add new provider' });
    expect(within(sheet).queryByRole('searchbox')).toBeNull();
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Title/ }), {
      target: { value: 'First visit' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add new provider' }));
    const inline = await screen.findByRole('dialog', { name: 'New doctor or clinic' });
    fireEvent.change(within(inline).getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Dr. Caio' },
    });
    fireEvent.change(within(inline).getByRole('textbox', { name: /^Clinic or hospital/ }), {
      target: { value: 'Hospital Norte' },
    });
    fireEvent.click(within(inline).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New doctor or clinic' })).toBeNull(),
    );
    const created = (await db.careProviders.toArray())[0]!;
    expect(created).toMatchObject({ name: 'Dr. Caio', clinicName: 'Hospital Norte' });
    expect(doctorBox(sheet)).toHaveProperty('value', 'Dr. Caio');
    expect(placeBox(sheet)).toHaveProperty('value', 'Hospital Norte');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await db.appointments.toArray())[0]?.providerId).toBe(created.id),
    );
    expect((await db.outbox.toArray()).map((m) => m.entityType)).toEqual([
      'careProvider',
      'appointment',
    ]);
  });
});

describe('the appointment detail', () => {
  const linked = appointment({
    providerId: 'ana',
    doctorName: 'Dr. Ana Lima',
    location: 'Clinic Sol, Rua das Flores, 10, Sao Paulo',
  });

  it('shows the saved doctor with call and maps links', async () => {
    await renderScreen([ANA], [linked]);

    fireEvent.click(await screen.findByRole('button', { name: /Checkup/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Checkup' });

    expect(await within(sheet).findByText('Saved doctor')).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: /Call/ }).getAttribute('href')).toBe(
      'tel:+551155550000',
    );
    expect(
      within(sheet)
        .getByRole('link', { name: /Open in maps/ })
        .getAttribute('href'),
    ).toContain('Rua%20das%20Flores');
    // The place already prints the address, so it is not repeated.
    expect(within(sheet).getAllByText(/Rua das Flores/)).toHaveLength(1);
  });

  it('prints the address of the provider when the place was edited away from it', async () => {
    await renderScreen([ANA], [{ ...linked, location: 'Annex' }]);

    fireEvent.click(await screen.findByRole('button', { name: /Checkup/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Checkup' });

    expect(await within(sheet).findByText(/Rua das Flores/)).toBeTruthy();
    expect(within(sheet).getByText('Annex')).toBeTruthy();
  });

  it('keeps the copied text and drops the links when the provider is deleted', async () => {
    await renderScreen([{ ...ANA, deleted: true }], [linked]);

    fireEvent.click(await screen.findByRole('button', { name: /Checkup/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Checkup' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(within(sheet).getByText('Dr. Ana Lima')).toBeTruthy();
    expect(within(sheet).getByText('Clinic Sol, Rua das Flores, 10, Sao Paulo')).toBeTruthy();
    expect(within(sheet).queryByText('Saved doctor')).toBeNull();
    expect(within(sheet).queryByRole('link')).toBeNull();
  });

  it('exports the .ics with the provider address and phone', async () => {
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:appointment';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await renderScreen([ANA], [{ ...linked, location: 'Annex' }]);

      fireEvent.click(await screen.findByRole('button', { name: /Checkup/ }));
      await screen.findByText('Saved doctor');
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));

      const text = await created[0]!.text();
      expect(text).toContain('LOCATION:Annex\\, Rua das Flores\\, 10\\, Sao Paulo');
      expect(text).toContain('Phone: +55 11 5555-0000');
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });
});

describe('pt-BR and accessibility', () => {
  it('reads the picker in Portuguese and has no violations', async () => {
    await useTestLocale('pt-BR');
    await renderScreen([ANA]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Nova consulta' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'Nova consulta' });
    await within(sheet).findByRole('button', { name: 'Adicionar novo' });
    expect(within(sheet).getByRole('searchbox', { name: 'Buscar médicos salvos' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: /Dr. Ana Lima.*Pediatra/ })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Adicionar novo' })).toBeTruthy();
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
