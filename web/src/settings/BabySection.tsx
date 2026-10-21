import { Alert, Chip, Stack, Typography } from '@mui/material';
import { OFFLINE_MESSAGE } from '../api/errorMessages';
import { BabyForm } from '../baby/BabyForm';
import { isOwner } from '../baby/permissions';
import { useBabyActions } from '../baby/useBabyActions';
import type { Baby } from '../db/models';
import { ErrorNotice } from './ErrorNotice';
import { useServerAction } from './useServerAction';

/** Baby details (editable by the Owner) and the current user's role. */
export function BabySection({ baby }: { baby: Baby }) {
  const { update } = useBabyActions();
  const { run, pending, error, online } = useServerAction();
  const owner = isOwner(baby);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography>Your role</Typography>
        <Chip label={baby.role} size="small" color={owner ? 'primary' : 'default'} />
      </Stack>
      {!owner && (
        <Typography color="text.secondary">Only the owner can change these details.</Typography>
      )}
      {owner && !online && <Alert severity="warning">{OFFLINE_MESSAGE}</Alert>}
      <ErrorNotice message={error} />
      {owner ? (
        <BabyForm
          key={`${baby.name}|${baby.birthDate}`}
          initial={{ name: baby.name, birthDate: baby.birthDate }}
          submitLabel="Save details"
          disabled={!online}
          pending={pending}
          onSubmit={(request) => void run(() => update(baby.id, request))}
        />
      ) : (
        <Stack>
          <Typography variant="subtitle1">{baby.name}</Typography>
          <Typography color="text.secondary">Born {baby.birthDate}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
