import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { formatTime } from '../../i18n/format';
import { atTimes } from '../../medications/prescriptionFixtures';
import { NotificationLinkContext } from '../../notifications/notificationLinkContext';
import type { NotificationLink } from '../../pwa/sw/deepLink';
import { fakeApi, httpError, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { BABY, nowApi, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * Opening the app from a dose reminder (docs/design/09-push-notifications.md sections 4 and 11):
 * the Meds tray opens at the prescription with "Reminder for 18:00" and Snooze; nothing is logged
 * or confirmed by opening.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const DELIVERY = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TOKEN = 'dGVzdC10b2tlbi10aGF0LWlzLWxvbmctZW5vdWdoLTEyMzQ';
const MINUTE = 60_000;

/** A scheduled Colidis dose whose slot (local time) passed `minutesAgo` minutes ago. */
async function seedScheduled(minutesAgo = 10) {
  const slot = new Date(Math.floor((Date.now() - minutesAgo * MINUTE) / MINUTE) * MINUTE);
  const hhmm = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`;
  const rx = atTimes('m-colidis', [hhmm]);
  await db.prescriptions.put({ ...rx, babyId: BABY.id });
  return { rx, slot };
}

function renderWithLink(link: NotificationLink, handler = nowApi()) {
  const consume = vi.fn();
  const fake = fakeApi(handler);
  renderWithDb(
    db,
    <NotificationLinkContext value={{ link, consume }}>
      <NowScreen baby={BABY} />
    </NotificationLinkContext>,
    { api: fake.api },
  );
  return { consume, ...fake };
}

const doseLink = (rxId: string, token: string | null = TOKEN): NotificationLink => ({
  kind: 'dose',
  babyId: BABY.id,
  rxId,
  deliveryId: DELIVERY,
  ...(token ? { token } : {}),
});

const medicationEvents = async () =>
  (await db.events.toArray()).filter((e) => Array.isArray(e.payload.medications));

describe('opening Now from a dose reminder', () => {
  it('opens the Meds tray at the prescription with the reminder line, and logs nothing', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { rx, slot } = await seedScheduled();
    const { consume } = renderWithLink(doseLink(rx.id));

    const tray = await screen.findByRole('dialog', { name: 'Medication' });
    expect(consume).toHaveBeenCalled();
    const card = within(tray)
      .getAllByRole('listitem')
      .find((item) => /Colidis/.test(item.textContent ?? ''))!;
    expect(within(card).getByText(`Reminder for ${formatTime(slot)}`)).toBeTruthy();
    // Guardrails: the card's own Log flow is unchanged and nothing was confirmed or logged.
    expect(within(card).getByRole('button', { name: /Log Colidis/ })).toBeTruthy();
    expect(within(card).queryByRole('group')).toBeNull();
    expect(await medicationEvents()).toEqual([]);
  });

  it('snoozes for 30 min, then stops reminders for this dose, with the delivery token', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { rx } = await seedScheduled();
    const { writes } = renderWithLink(doseLink(rx.id));

    fireEvent.click(await screen.findByRole('button', { name: 'Snooze 30 min' }));
    expect(await screen.findByText('Snoozed for 30 min.')).toBeTruthy();
    const actionPath = `/api/v1/push/deliveries/${DELIVERY}/actions`;
    expect(writes().filter((c) => c.path === actionPath)).toEqual([
      expect.objectContaining({ method: 'POST', body: { action: 'snooze', token: TOKEN } }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Stop reminders for this dose' }));
    expect(await screen.findByText('No more reminders for this dose.')).toBeTruthy();
    expect(
      writes()
        .filter((c) => c.path === actionPath)
        .at(-1)?.body,
    ).toEqual({
      action: 'dismiss',
      token: TOKEN,
    });
    expect(await medicationEvents()).toEqual([]);
  });

  it('shows the server limit after the third snooze', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { rx } = await seedScheduled();
    renderWithLink(doseLink(rx.id), (call) => {
      if (call.path.endsWith('/actions')) throw httpError(409, 'snooze_limit_reached');
      return nowApi()(call);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze 30 min' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Snooze 30 min' })).toBeTruthy();
  });

  it('offers no snooze without a token', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { rx } = await seedScheduled();
    renderWithLink(doseLink(rx.id, null));
    const tray = await screen.findByRole('dialog', { name: 'Medication' });
    expect(within(tray).getByText(/^Reminder for/)).toBeTruthy();
    expect(within(tray).queryByRole('button', { name: 'Snooze 30 min' })).toBeNull();
  });

  it('shows no reminder line once the dose is logged (local data decides)', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { rx } = await seedScheduled();
    await putEvent(db, 'medication', 5, 5, {
      medications: [{ medicationId: 'm-colidis', name: 'Colidis', prescriptionId: rx.id }],
    });
    renderWithLink(doseLink(rx.id));
    const tray = await screen.findByRole('dialog', { name: 'Medication' });
    expect(within(tray).queryByText(/^Reminder for/)).toBeNull();
    expect(within(tray).queryByRole('button', { name: 'Snooze 30 min' })).toBeNull();
  });

  it('a nap reminder just shows Now', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const nap = renderWithLink({ kind: 'nap', babyId: BABY.id, deliveryId: DELIVERY });
    await waitFor(() => expect(nap.consume).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores a link for another baby', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const { rx } = await seedScheduled();
    const { consume } = renderWithLink({ ...doseLink(rx.id), babyId: 'other-baby' });
    await screen.findByRole('button', { name: /^Meds/ });
    expect(consume).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe.each(['light', 'dark'] as const)('the reminder line in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await seedNow(db);
      await seedMorning(db, 112);
      const { rx } = await seedScheduled();
      renderWithLink(doseLink(rx.id));
      await screen.findByRole('button', {
        name: locale === 'en' ? 'Snooze 30 min' : 'Adiar 30 min',
      });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
