import { useMemo } from 'react';
import { agendaOf } from '../appointments/appointmentModel';
import { dayKeyOf } from '../appointments/calendarModel';
import { canDecideProposals, canSeeAppointments } from '../baby/permissions';
import { useAppointments } from '../db/hooks';
import type { Appointment, Baby } from '../db/models';
import { useNow } from '../events/time';
import { useDoctorInbox } from '../proposals/useProposals';
import { useVaccinations } from '../vaccines/useVaccinations';
import { useVaccineSchedule } from '../vaccines/useVaccineSchedule';
import { dueNow, overviewOf } from '../vaccines/vaccineModel';
import type { HubEntryId } from './hubEntries';

/** An appointment this close (or sooner) puts a badge on Appointments. */
export const APPOINTMENT_SOON_DAYS = 3;
const DAY_MS = 86_400_000;

/** How many upcoming appointments start within `days` days. Pure. */
export function appointmentsSoon(
  appointments: readonly Appointment[],
  now: number,
  days = APPOINTMENT_SOON_DAYS,
): number {
  const limit = now + days * DAY_MS;
  return agendaOf(appointments, now).upcoming.filter((a) => Date.parse(a.startsAt) <= limit).length;
}

export interface HubAttention {
  /** Entries that need a look, with how many things wait in each. */
  counts: Partial<Record<HubEntryId, number>>;
  /** What the Hub tab's dot counts: each waiting thing once (the notes badge repeats the inbox). */
  total: number;
}

const NO_BABY = { id: '', userId: undefined } as const;

/**
 * What waits for the person, from the local data only (no network of its own): vaccines due or
 * overdue, the doctor's proposals and unread recommendations (Owners and Parents), appointments in
 * the next few days. Feeds the Hub's entry badges and the dot on the Hub tab.
 */
export function useHubAttention(baby: Baby | undefined): HubAttention {
  const now = useNow(60_000);
  const { schedule } = useVaccineSchedule();
  const records = useVaccinations(baby?.id ?? NO_BABY.id);
  const appointments = useAppointments(baby?.id ?? NO_BABY.id);
  const inbox = useDoctorInbox(baby ?? NO_BABY);
  const today = dayKeyOf(now);

  const vaccines = useMemo(() => {
    if (!baby || !schedule || !records) return 0;
    const overview = overviewOf({ schedule, baby, records, today });
    return overview ? dueNow(overview.views).length : 0;
  }, [baby, schedule, records, today]);

  return useMemo(() => {
    const counts: HubAttention['counts'] = {};
    if (!baby) return { counts, total: 0 };
    if (vaccines > 0) counts.vaccines = vaccines;
    if (canSeeAppointments(baby) && appointments) {
      const soon = appointmentsSoon(appointments, now);
      if (soon > 0) counts.appointments = soon;
    }
    if (canDecideProposals(baby) && inbox) {
      if (inbox.count > 0) counts.fromDoctor = inbox.count;
      if (inbox.unread.length > 0) counts.notes = inbox.unread.length;
    }
    const total = (counts.vaccines ?? 0) + (counts.appointments ?? 0) + (counts.fromDoctor ?? 0);
    return { counts, total };
  }, [baby, vaccines, appointments, inbox, now]);
}
