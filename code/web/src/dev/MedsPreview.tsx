import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { cacheProducts } from '../db/catalogCache';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, Medication, Prescription } from '../db/models';
import { MedicationChooser } from '../medications/MedicationChooser';
import { PrescriptionSheet } from '../medications/PrescriptionSheet';
import { MedicationDialog } from '../settings/MedicationDialog';
import { MedicationsSection } from '../settings/MedicationsSection';
import type { ProductDto } from '../sync/contract';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/meds`, never in production builds): the medications screens over a
 * throw-away local database, one scenario at a time (`?state=settings`, `&scheme=dark`). No
 * sign-in, no server: the shared catalog is served from the products seeded on the device.
 */

const SCENARIOS = [
  'settings',
  'editor-new',
  'editor-med',
  'editor-times',
  'editor-edit',
  'chooser',
  'dialog',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const BABY_ID = 'dev-meds-baby';
const baby: Baby = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };
const MIN = 60_000;

const medication = (
  id: string,
  name: string,
  isUsual: boolean,
  productId: string | null,
  defaultDosage: Medication['defaultDosage'] = null,
): Medication => ({
  id,
  babyId: BABY_ID,
  name,
  isUsual,
  defaultDosage,
  productId,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
});

const SIMETHICONE = {
  substanceId: 's-sim',
  key: 'simethicone',
  nameEn: 'Simethicone',
  namePtBr: 'Simeticona',
  strength: { amount: 75, unit: 'mg', perAmount: 1, perUnit: 'mL' },
};

const product = (id: string, name: string, form: ProductDto['form']): ProductDto => ({
  id,
  name,
  form,
  country: 'BR',
  status: 'seed',
  mergedIntoId: null,
  substances: [SIMETHICONE],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const PRODUCTS = [
  product('p-flygas', 'Flygas', 'drops'),
  product('p-luftal', 'Luftal', 'drops'),
  { ...product('p-colidis', 'Colidis', 'drops'), substances: [] },
];

function clockAgo(minAgo: number): string {
  const d = new Date(Date.now() - minAgo * MIN);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function prescription(
  over: Partial<Prescription> & Pick<Prescription, 'id' | 'medicationId'>,
): Prescription {
  return {
    babyId: BABY_ID,
    status: 'active',
    kind: 'asNeeded',
    dose: { amount: 2, unit: 'drops', perKg: false, roundingStep: null },
    timesOfDay: null,
    everyMinutes: null,
    minIntervalMinutes: 480,
    maxDosesPer24h: null,
    indication: null,
    intervalGroup: null,
    startDate: '2026-09-01',
    endDate: null,
    prescriber: null,
    instructions: null,
    createdBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

const PRESCRIPTIONS: Prescription[] = [
  prescription({
    id: 'rx-colidis',
    medicationId: 'm-colidis',
    dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
    maxDosesPer24h: 3,
    indication: 'belly pain',
    intervalGroup: 'colic',
    prescriber: 'Dr. Silva',
  }),
  prescription({
    id: 'rx-flygas',
    medicationId: 'm-flygas',
    dose: { amount: 10, unit: 'drops', perKg: false, roundingStep: null },
    minIntervalMinutes: 360,
    intervalGroup: 'colic',
  }),
  prescription({
    id: 'rx-vitd',
    medicationId: 'm-vitd',
    kind: 'scheduled',
    minIntervalMinutes: null,
    timesOfDay: [clockAgo(30), '23:00'],
  }),
  prescription({
    id: 'rx-old',
    medicationId: 'm-flygas',
    status: 'stopped',
    minIntervalMinutes: 240,
    endDate: '2026-09-20',
  }),
];

async function seed(db: BabyRoutineDb): Promise<void> {
  await Promise.all([
    db.babies.clear(),
    db.medications.clear(),
    db.prescriptions.clear(),
    db.catalogProducts.clear(),
    db.bodyWeights.clear(),
  ]);
  await db.babies.put(baby);
  await db.medications.bulkPut([
    medication('m-colidis', 'Colidis', true, 'p-colidis', { amount: 5, unit: 'drops' }),
    medication('m-flygas', 'Flygas', true, 'p-flygas', { amount: 10, unit: 'drops' }),
    medication('m-vitd', 'Vitamin D', false, null),
  ]);
  await db.prescriptions.bulkPut(PRESCRIPTIONS);
  await cacheProducts(db, PRODUCTS);
  const weighed = new Date(Date.now() - 6 * 24 * 60 * MIN);
  await db.bodyWeights.put({
    babyId: BABY_ID,
    kg: 4.6,
    date: `${weighed.getFullYear()}-${String(weighed.getMonth() + 1).padStart(2, '0')}-${String(weighed.getDate()).padStart(2, '0')}`,
  });
}

function Body({ scenario }: { scenario: Scenario }) {
  const [closed, setClosed] = useState(false);
  const done = () => setClosed(true);
  if (scenario === 'settings') return <MedicationsSection baby={baby} />;
  if (scenario === 'chooser') {
    return <MedicationChooser babyId={BABY_ID} value={null} onChange={() => {}} />;
  }
  if (closed) return null;
  if (scenario === 'dialog') return <MedicationDialog babyId={BABY_ID} onClose={done} />;
  if (scenario === 'editor-edit') {
    return <PrescriptionSheet babyId={BABY_ID} prescription={PRESCRIPTIONS[0]} onDone={done} />;
  }
  return (
    <PrescriptionSheet
      babyId={BABY_ID}
      {...(scenario === 'editor-med' ? { medicationId: 'm-colidis' } : {})}
      {...(scenario === 'editor-times' ? { medicationId: 'm-vitd' } : {})}
      onDone={done}
    />
  );
}

/** Developer-only: the medications screens with seeded local data (`/dev/meds?state=settings`). */
export default function MedsPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'settings';
  const [db] = useState(() => createDatabase('dev-meds-preview'));
  const [ready, setReady] = useState<Scenario | null>(null);

  useEffect(() => {
    let live = true;
    void seed(db).then(() => live && setReady(scenario));
    return () => {
      live = false;
    };
  }, [db, scenario]);

  return (
    <DatabaseProvider db={db}>
      <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
        <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: 12 }}>
          <Typography variant="h5" component="h1" sx={{ py: 1 }}>
            Lia
          </Typography>
          {ready === scenario && <Body key={scenario} scenario={scenario} />}
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
