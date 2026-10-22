import { useTranslation } from 'react-i18next';
import { Stack, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import type { WeightPoint } from '../insights/formulaComparison';
import { InsightsComingCard, InsightsSection } from '../insights/InsightsSection';
import { useMeasurements } from '../measurements/useMeasurements';
import { GrowthPage } from './GrowthPage';

/** The selected baby's insights with the measured weights (online; the Formulas ml per kg). */
function BabyInsights({ baby }: { baby: Baby }) {
  const { query } = useMeasurements(baby.id);
  const weights: WeightPoint[] = (query.data ?? []).flatMap((m) =>
    typeof m.weightKg === 'number' ? [{ date: m.date, kg: m.weightKg }] : [],
  );
  return <InsightsSection baby={baby} weights={weights} />;
}

/**
 * Insights (third tab): the sleep, feeding and diaper insights of the selected baby, worked out
 * from the local data (each one opens after a few days with data, with a progress row and an
 * estimate until then), and Growth under its own heading.
 */
export function InsightsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        {t('nav.insights')}
      </Typography>
      {baby && <BabyInsights key={baby.id} baby={baby} />}
      {babies && !baby && <InsightsComingCard />}
      <GrowthPage heading="h2" />
    </Stack>
  );
}
