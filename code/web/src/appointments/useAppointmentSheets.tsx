import { useState } from 'react';
import { canWrite } from '../baby/permissions';
import type { Appointment, Baby } from '../db/models';
import { AppointmentDetailSheet } from './AppointmentDetailSheet';
import { AppointmentSheet } from './AppointmentSheet';
import type { DayKey } from './calendarModel';

type Open =
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; id: string }
  | { kind: 'new'; day?: DayKey }
  | null;

/**
 * The appointment sheets of a screen (calendar page, Day): the detail of one appointment, its edit
 * sheet and the new-appointment sheet. The detail reads the live copy from `appointments`, so a
 * cancel, a "done" or a pulled change shows at once. Only Owners and Parents can edit or add.
 */
export function useAppointmentSheets(
  baby: Baby,
  appointments: readonly Appointment[] | undefined,
  now: number,
) {
  const [open, setOpen] = useState<Open>(null);
  const writable = canWrite(baby);
  const find = (id: string) => appointments?.find((appointment) => appointment.id === id);
  const shown = open && open.kind !== 'new' ? find(open.id) : undefined;
  const close = () => setOpen(null);

  const elements = (
    <>
      {open?.kind === 'detail' && shown && (
        <AppointmentDetailSheet
          appointment={shown}
          writable={writable}
          now={now}
          onClose={close}
          onEdit={(appointment) => setOpen({ kind: 'edit', id: appointment.id })}
        />
      )}
      {writable && open?.kind === 'edit' && shown && (
        <AppointmentSheet
          babyId={baby.id}
          appointment={shown}
          now={now}
          onClose={() => setOpen({ kind: 'detail', id: shown.id })}
        />
      )}
      {writable && open?.kind === 'new' && (
        <AppointmentSheet
          babyId={baby.id}
          {...(open.day ? { initialDay: open.day } : {})}
          now={now}
          onClose={close}
        />
      )}
    </>
  );

  return {
    writable,
    openDetail: (id: string) => setOpen({ kind: 'detail', id }),
    openNew: (day?: DayKey) => setOpen(day ? { kind: 'new', day } : { kind: 'new' }),
    elements,
  };
}
