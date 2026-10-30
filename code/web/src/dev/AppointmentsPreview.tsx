import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { AppointmentDetailSheet } from '../appointments/AppointmentDetailSheet';
import { AppointmentSheet } from '../appointments/AppointmentSheet';
import { AppointmentsScreen } from '../appointments/AppointmentsScreen';
import { dayKeyOf } from '../appointments/calendarModel';
import { NextAppointmentCard } from '../appointments/NextAppointmentCard';
import { DayScreen } from '../day/DayScreen';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Appointment, Baby, BabyRole } from '../db/models';
import { currentLocale } from '../i18n/i18n';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { PREVIEW_BABY_ID, PREVIEW_TYPES } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/appointments`, never in production builds): the appointment screens
 * over a throw-away local database (docs/design/15-appointments.md). `?state=month` (calendar and
 * agenda), `day` (a day chosen in the calendar), `sheet` (new appointment), `edit` (a visit marked
 * done, with its outcome), `detail` (an upcoming one), `ask` ("Did it happen?" after the start),
 * `now` (the Now card), `daystrip` (the Day screen strip), `caregiver` and `caregiverDetail`
 * (read-only), `empty`. Dates follow today; titles follow the language. No sign-in, no server.
 */

const SCENARIOS = [
  'month',
  'day',
  'sheet',
  'edit',
  'detail',
  'ask',
  'now',
  'daystrip',
  'caregiver',
  'caregiverDetail',
  'empty',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const babyOf = (role: BabyRole): Baby => ({
  id: PREVIEW_BABY_ID,
  name: 'Lia',
  birthDate: '2026-08-20',
  role,
});

/** A local wall-clock time `days` from today. */
function at(days: number, hour: number, minute = 0): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + days,
    hour,
    minute,
  ).toISOString();
}

type Text = [en: string, pt: string];
const pick = ([en, pt]: Text) => (currentLocale() === 'pt-BR' ? pt : en);

function appointment(id: string, title: Text, extra: Partial<Appointment>): Appointment {
  return {
    id: `dev-appt-${id}`,
    babyId: PREVIEW_BABY_ID,
    title: pick(title),
    type: 'consultation',
    startsAt: at(2, 10, 30),
    durationMinutes: null,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdBy: null,
    createdAt: at(-40, 9),
    updatedAt: at(-40, 9),
    ...extra,
  };
}

function appointments(): Appointment[] {
  const laterToday = Math.min(22, new Date().getHours() + 3);
  return [
    appointment('next', ['Pediatrician (2 months)', 'Pediatra (2 meses)'], {
      startsAt: at(2, 10, 30),
      durationMinutes: 30,
      location: 'Clínica Sorriso, sala 4',
      doctorName: 'Dra. Ana Lima',
      notes: pick([
        'Bring the vaccine card and the growth questions.',
        'Levar a caderneta de vacinação e as dúvidas sobre crescimento.',
      ]),
    }),
    appointment('vaccine', ['Vaccines: 2 months', 'Vacinas de 2 meses'], {
      type: 'vaccine',
      startsAt: at(9, 14, 0),
      location: 'UBS Centro',
      reminderOffsetsMinutes: [10080, 1440],
    }),
    appointment('today', ['Hearing test', 'Teste da orelhinha'], {
      type: 'exam',
      startsAt: at(0, laterToday, 0),
      durationMinutes: 45,
      location: 'Hospital São Lucas',
      reminderOffsetsMinutes: [120, 30],
    }),
    appointment('later', ['Ophthalmologist', 'Oftalmologista'], { startsAt: at(20, 8, 45) }),
    appointment('ask', ['Hip ultrasound', 'Ultrassom do quadril'], {
      type: 'exam',
      startsAt: at(-2, 16, 0),
      durationMinutes: 30,
      location: 'Clínica Imagem',
    }),
    appointment('cancelled', ['Lactation consultant', 'Consultora de amamentação'], {
      type: 'other',
      startsAt: at(-5, 11, 0),
      status: 'cancelled',
    }),
    appointment('done', ['Pediatrician (1 month)', 'Pediatra (1 mês)'], {
      startsAt: at(-30, 9, 0),
      durationMinutes: 40,
      doctorName: 'Dra. Ana Lima',
      status: 'done',
      outcome: pick([
        'Weight 4.6 kg, all good. Next visit at 2 months.',
        'Peso 4,6 kg, tudo bem. Próxima consulta aos 2 meses.',
      ]),
    }),
    appointment('bcg', ['BCG vaccine', 'Vacina BCG'], {
      type: 'vaccine',
      startsAt: at(-12, 10, 0),
      status: 'done',
    }),
  ];
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<Appointment[]> {
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.appointments.clear(),
    db.outbox.clear(),
  ]);
  const caregiver = scenario === 'caregiver' || scenario === 'caregiverDetail';
  await db.babies.put(babyOf(caregiver ? 'Caregiver' : 'Owner'));
  await db.eventTypes.bulkPut(PREVIEW_TYPES);
  const list = scenario === 'empty' ? [] : appointments();
  await db.appointments.bulkPut(list);
  return list;
}

const byId = (list: readonly Appointment[], id: string) =>
  list.find((a) => a.id === `dev-appt-${id}`)!;

function Body({ scenario, list }: { scenario: Scenario; list: Appointment[] }) {
  const [closed, setClosed] = useState(false);
  const [now] = useState(() => Date.now());
  const owner = babyOf('Owner');
  const done = () => setClosed(true);
  switch (scenario) {
    case 'month':
    case 'empty':
      return <AppointmentsScreen baby={owner} />;
    case 'day':
      return (
        <AppointmentsScreen baby={owner} initialSelected={dayKeyOf(byId(list, 'next').startsAt)} />
      );
    case 'caregiver':
      return <AppointmentsScreen baby={babyOf('Caregiver')} />;
    case 'now':
      return <NextAppointmentCard appointment={byId(list, 'next')} now={now} />;
    case 'daystrip':
      return (
        <AddSheetProvider enabled>
          <DayScreen baby={owner} />
        </AddSheetProvider>
      );
    default:
      break;
  }
  if (closed) return null;
  if (scenario === 'sheet') return <AppointmentSheet babyId={PREVIEW_BABY_ID} onClose={done} />;
  if (scenario === 'edit') {
    return (
      <AppointmentSheet babyId={PREVIEW_BABY_ID} appointment={byId(list, 'done')} onClose={done} />
    );
  }
  const shown = byId(list, scenario === 'ask' ? 'ask' : 'next');
  return (
    <AppointmentDetailSheet
      appointment={shown}
      writable={scenario !== 'caregiverDetail'}
      now={now}
      onClose={done}
      onEdit={done}
    />
  );
}

/** Developer-only: the appointment screens with seeded local data (`/dev/appointments?state=month`). */
export default function AppointmentsPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'month';
  const [db] = useState(() => createDatabase('dev-appointments-preview'));
  const [ready, setReady] = useState<{ scenario: Scenario; list: Appointment[] } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let live = true;
    void seed(db, scenario).then((list) => {
      queryClient.setQueryData(['members', PREVIEW_BABY_ID], []);
      if (live) setReady({ scenario, list });
    });
    return () => {
      live = false;
    };
  }, [db, scenario, queryClient]);

  return (
    <DatabaseProvider db={db}>
      <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
        <Box
          sx={{
            maxWidth: 480,
            mx: 'auto',
            px: 2,
            pt: 1,
            pb: 12,
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'minmax(0, 1fr)',
          }}
        >
          <Typography variant="h5" component="p" sx={{ py: 1 }}>
            Lia
          </Typography>
          {ready?.scenario === scenario && (
            <Body key={scenario} scenario={scenario} list={ready.list} />
          )}
          <PreviewToolbar
            scenarios={SCENARIOS}
            scenario={scenario}
            onScenario={(next) => setParams({ state: next }, { replace: true })}
          />
        </Box>
        <UndoSnackbar />
      </Box>
    </DatabaseProvider>
  );
}
