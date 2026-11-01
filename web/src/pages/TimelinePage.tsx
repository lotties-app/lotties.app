import { CircularProgress, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { BabyTimeline } from '../timeline/BabyTimeline';

export function TimelinePage() {
  const { babies, baby } = useSelectedBaby();

  if (!babies) return <CircularProgress aria-label="Loading" />;
  if (!baby) {
    return (
      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        No baby yet. Events appear here once a baby syncs from the server.
      </Typography>
    );
  }
  return <BabyTimeline key={baby.id} baby={baby} />;
}
