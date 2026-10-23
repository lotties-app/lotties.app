import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { changeDoctorScopes } from '../api/managementApi';
import type { Baby } from '../db/models';
import { SheetFrame } from '../now/ui/SheetFrame';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import { DoctorScopeFields } from './DoctorScopeFields';
import { sameScopes, type DoctorScope } from './scopes';

/**
 * "Doctor access" (docs/design/19-doctor-dashboard.md section 2): the Owner changes which sections
 * a doctor already in Members sees. The server applies it to her next request; her device forgets
 * a section on its next sync.
 */
export function DoctorAccessSheet({
  baby,
  doctor,
  userId,
  initial,
  onClose,
}: {
  baby: Baby;
  /** The doctor's name as Members shows it ("Dr. Ana Souza"). */
  doctor: string;
  userId: string;
  initial: readonly DoctorScope[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { run, pending, error, online } = useServerAction();
  const [scopes, setScopes] = useState<DoctorScope[]>([...initial]);
  const unchanged = sameScopes(scopes, initial);

  const save = async () => {
    const ok = await run(async () => {
      await changeDoctorScopes(api, baby.id, userId, scopes);
      await queryClient.invalidateQueries({ queryKey: ['members', baby.id] });
    });
    if (ok) onClose();
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={t('doctorDashboard.access.title')}
      subtitle={t('doctorDashboard.access.intro', { doctor, baby: baby.name })}
    >
      <ErrorNotice message={error} />
      <DoctorScopeFields value={scopes} onChange={setScopes} disabled={pending} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          disabled={pending || unchanged || !online}
          onClick={() => void save()}
          sx={{ minHeight: 48, borderRadius: '999px', px: 3 }}
        >
          {t('doctorDashboard.access.save')}
        </Button>
      </Box>
    </SheetFrame>
  );
}
