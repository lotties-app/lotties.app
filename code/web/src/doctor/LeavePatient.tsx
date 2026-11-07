import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApiClient } from '../api/ApiClientContext';
import { leaveBaby } from '../api/managementApi';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby } from '../db/models';
import { countUnsyncedMutations } from '../db/outbox';
import { purgeBabyData } from '../db/purge';
import { UnsyncedChangesDialog } from '../session/UnsyncedChangesDialog';
import { unsyncedChangesLabel, usePushThenProceed } from '../session/usePushThenProceed';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { useServerAction } from '../settings/useServerAction';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { babyShownName } from '../baby/shownName';

/**
 * "Stop following Lia": the doctor ends her own access (`DELETE /members/me`), like leaving a baby
 * in Members, which she never sees. Her unsynced notes and proposals of the patient would be lost:
 * she is offered to send them first. The patient then leaves this device.
 */
export function LeavePatient({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const db = useDatabase();
  const engine = useSyncEngine();
  const navigate = useNavigate();
  const { run, pending, error, online, clearError } = useServerAction();
  const [step, setStep] = useState<'confirm' | 'unsynced' | null>(null);
  const countUnsynced = () => countUnsyncedMutations(db, baby.id);
  const unsynced = useLiveQuery(countUnsynced, [db, baby.id]) ?? 0;

  const leave = async () => {
    const ok = await run(async () => {
      await leaveBaby(api, baby.id);
      await purgeBabyData(db, baby.id);
      void engine.syncNow();
    });
    if (ok) {
      setStep(null);
      navigate('/doctor', { replace: true });
    }
  };
  const pushFirst = usePushThenProceed(countUnsynced, leave);
  const close = () => {
    clearError();
    pushFirst.clearError();
    setStep(null);
  };

  return (
    <>
      <Button
        color="error"
        variant="outlined"
        disabled={!online}
        onClick={() =>
          void countUnsynced().then((count) => setStep(count > 0 ? 'unsynced' : 'confirm'))
        }
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('doctorDashboard.leave.button', { name: babyShownName(baby) })}
      </Button>
      {step === 'confirm' && (
        <ConfirmDialog
          title={t('doctorDashboard.leave.title', { name: babyShownName(baby) })}
          body={t('doctorDashboard.leave.body', { name: babyShownName(baby) })}
          confirmLabel={t('doctorDashboard.leave.confirm')}
          pending={pending}
          error={error}
          onCancel={close}
          onConfirm={() => void leave()}
        />
      )}
      {step === 'unsynced' && (
        <UnsyncedChangesDialog
          title={t('doctorDashboard.leave.title', { name: babyShownName(baby) })}
          message={t('settings.members.leaveUnsynced', {
            changes: unsyncedChangesLabel(unsynced),
            name: babyShownName(baby),
          })}
          pushLabel={t('settings.members.pushFirst')}
          proceedLabel={t('doctorDashboard.leave.confirm')}
          pending={pending || pushFirst.pushing}
          error={pushFirst.error ?? error}
          onPush={() => void pushFirst.pushThenProceed()}
          onProceed={() => void leave()}
          onCancel={close}
        />
      )}
    </>
  );
}
