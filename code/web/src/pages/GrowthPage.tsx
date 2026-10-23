import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import {
  canChangeMeasurement,
  canRecordMeasurements,
  isCaregiver,
  isDoctor,
} from '../baby/permissions';
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
import { Icon } from '../ui/Icon';

type Editing = MeasurementDto | 'new' | null;

export type HeadingLevel = 'h1' | 'h2';

/** The growth list and charts of one baby (also the doctor's Growth page). */
export function Growth({ baby, heading }: { baby: Baby; heading: HeadingLevel }) {
  const { t } = useTranslation();
  const { query, online } = useMeasurements(baby.id);
  const actions = useMeasurementActions(baby.id);
  const { run, pending, error, clearError } = useServerAction();
  const writable = canRecordMeasurements(baby);
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
        <Typography variant="h5" component={heading}>
          {t('nav.growth')}
        </Typography>
        {writable && (
          <Button
            variant="contained"
            startIcon={<Icon name="add" />}
            disabled={!online}
            onClick={() => setEditing('new')}
            sx={{ minHeight: 48 }}
          >
            {t('growth.add')}
          </Button>
        )}
      </Stack>
      {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      {isDoctor(baby) && (
        <Alert severity="info">{t('doctor.growth.doctorNotice', { name: baby.name })}</Alert>
      )}
      {!writable && (
        <Alert severity="info">
          {t(isCaregiver(baby) ? 'baby.caregiverNamed' : 'baby.viewOnlyNamed', { name: baby.name })}
        </Alert>
      )}
      {query.isError && <ErrorNotice message={t('growth.loadFailed')} />}
      {!deleting && <ErrorNotice message={error} />}
      {query.isPending && online && <CircularProgress aria-label={t('common.loading')} />}
      {measurements && (
        <>
          {METRICS.map((metric) => (
            <GrowthChart key={metric.key} metric={metric} measurements={measurements} />
          ))}
          {measurements.length === 0 ? (
            <Typography color="text.secondary">{t('growth.none')}</Typography>
          ) : (
            <MeasurementList
              measurements={measurements}
              canChange={(m) => online && canChangeMeasurement(baby, m)}
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
          title={t('growth.deleteTitle')}
          body={t('growth.deleteBody')}
          confirmLabel={t('growth.deleteConfirm')}
          pending={pending}
          error={error}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </Stack>
  );
}

/**
 * Growth measurements. Inside Insights the section heading is an `h2` (the page owns the `h1`);
 * the legacy `/growth` route redirects there.
 */
export function GrowthPage({ heading = 'h1' }: { heading?: HeadingLevel }) {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) {
    return <Alert severity="info">{t('growth.createBabyFirst')}</Alert>;
  }
  return <Growth key={baby.id} baby={baby} heading={heading} />;
}
