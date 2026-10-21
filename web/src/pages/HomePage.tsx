import { CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { CreateBabyCard } from '../baby/CreateBabyCard';
import { BabyHome } from '../home/BabyHome';

export function HomePage() {
  const { babies, baby } = useSelectedBaby();

  if (!babies) return <CircularProgress aria-label="Loading" />;
  if (!baby) return <CreateBabyCard />;
  return <BabyHome key={baby.id} baby={baby} />;
}
