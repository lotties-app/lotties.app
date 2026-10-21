import { useState } from 'react';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { OFFLINE_MESSAGE } from '../api/errorMessages';
import { canWrite } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import { GrowthChart } from '../measurements/GrowthChart';
import { MeasurementDialog } from '../measurements/MeasurementDialog';
import { MeasurementList } from '../measurements/MeasurementList';
import { METRICS } from '../measurements/measurementModel';
import { useMeasurementActions, useMeasurements } from '../measurements/useMeasurements';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import type { MeasurementDto } from '../sync/contract';

type Editing = MeasurementDto | 'new' | null;

function Growth({ baby }: { baby: Baby }) {
  const { query, online } = useMeasurements(baby.id);
  const actions = useMeasurementActions(baby.id);
  const { run, pending, error, clearError } = useServerAction();
  const writable = canWrite(baby);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<MeasurementDto | null>(null);
  const measurements = query.data;

  const confirmDelete = async (target: MeasurementDto) => {
    if (await run(() => actions.remove(target.id))) setDeleting(null);
  };
  const cancelDelete = () => {
    clearError();
    setDeleting(null);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="h1">
          Growth
        </Typography>
        {writable && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!online}
            onClick={() => setEditing('new')}
            sx={{ minHeight: 48 }}
          >
            Add measurement
          </Button>
        )}
      </Stack>
      {!online && <Alert severity="warning">{OFFLINE_MESSAGE}</Alert>}
      {!writable && <Alert severity="info">You have view-only access to {baby.name}.</Alert>}
      {query.isError && <ErrorNotice message="Could not load measurements. Try again later." />}
      {!deleting && <ErrorNotice message={error} />}
      {query.isPending && online && <CircularProgress aria-label="Loading" />}
      {measurements && (
        <>
          {METRICS.map((metric) => (
            <GrowthChart key={metric.key} metric={metric} measurements={measurements} />
          ))}
          {measurements.length === 0 ? (
            <Typography color="text.secondary">No measurements yet.</Typography>
          ) : (
            <MeasurementList
              measurements={measurements}
              writable={writable && online}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          )}
        </>
      )}
      {editing && (
        <MeasurementDialog
          babyId={baby.id}
          measurement={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this measurement?"
          body="This removes it from the list and the charts."
          confirmLabel="Delete measurement"
          pending={pending}
          error={error}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </Stack>
  );
}

export function GrowthPage() {
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label="Loading" />;
  if (!baby) {
    return <Alert severity="info">Create a baby on the Home screen to track growth.</Alert>;
  }
  return <Growth key={baby.id} baby={baby} />;
}
