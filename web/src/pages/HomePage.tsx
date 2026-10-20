import { CircularProgress, Stack, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { BabyHome } from '../home/BabyHome';

export function HomePage() {
  const { babies, baby } = useSelectedBaby();

  if (!babies) return <CircularProgress aria-label="Loading" />;
  if (!baby) {
    // Baby creation is a server operation (API task 4); until a local command exists we only explain.
    return (
      <Stack spacing={1} sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="h6">No baby yet</Typography>
        <Typography color="text.secondary">
          Babies appear here once they sync from the server. Creating a baby is not available yet.
        </Typography>
      </Stack>
    );
  }
  return <BabyHome key={baby.id} baby={baby} />;
}
