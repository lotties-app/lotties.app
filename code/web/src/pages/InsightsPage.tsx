import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import type { WeightPoint } from '../insights/formulaComparison';
import { InsightsComingCard, InsightsSection } from '../insights/InsightsSection';
import { useMeasurements } from '../measurements/useMeasurements';
import { RestOptInCard } from '../rest/RestOptInCard';
import { RestTab } from '../rest/RestTab';
import { useRestSettings } from '../rest/useRest';
import { GrowthPage } from './GrowthPage';

/** The selected baby's insights with the measured weights (online; the Formulas ml per kg). */
function BabyInsights({ baby }: { baby: Baby }) {
  const { query } = useMeasurements(baby.id);
  const weights: WeightPoint[] = (query.data ?? []).flatMap((m) =>
    typeof m.weightKg === 'number' ? [{ date: m.date, kg: m.weightKg }] : [],
  );
  return <InsightsSection baby={baby} weights={weights} />;
}

type InsightsTab = 'insights' | 'rest';

/**
 * Insights (third tab): the sleep, feeding and diaper insights of the selected baby, worked out
 * from the local data (each one opens after a few days with data, with a progress row and an
 * estimate until then), and Growth under its own heading. When the person has turned the rest
 * estimate on (docs/design/41-caregiver-rest.md) a second tab, Rest, appears; until then a small
 * opt-in card offers it.
 */
export function InsightsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const { query: restSettings } = useRestSettings();
  const [tab, setTab] = useState<InsightsTab>('insights');
  const ids = useId();
  // "Add measurements" after a visit links here (`#growth`): bring Growth into view.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#growth') document.getElementById('growth')?.scrollIntoView?.({ block: 'start' });
  }, [hash, baby, tab]);
  const rest = restSettings.data ?? null;
  const restOn = rest?.enabled === true;
  const active = restOn ? tab : 'insights';
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        {t('nav.insights')}
      </Typography>
      {rest && !restOn && <RestOptInCard settings={rest} />}
      {restOn && (
        <Tabs
          value={active}
          onChange={(_, next: InsightsTab) => setTab(next)}
          aria-label={t('rest.tabsLabel')}
          variant="fullWidth"
        >
          <Tab
            value="insights"
            id={`${ids}-insights`}
            aria-controls={`${ids}-insights-panel`}
            label={t('nav.insights')}
            sx={{ minHeight: 48 }}
          />
          <Tab
            value="rest"
            id={`${ids}-rest`}
            aria-controls={`${ids}-rest-panel`}
            label={t('rest.tab')}
            sx={{ minHeight: 48 }}
          />
        </Tabs>
      )}
      {active === 'rest' && rest ? (
        <Box role="tabpanel" id={`${ids}-rest-panel`} aria-labelledby={`${ids}-rest`}>
          <RestTab settings={rest} />
        </Box>
      ) : (
        <Box
          role={restOn ? 'tabpanel' : undefined}
          id={`${ids}-insights-panel`}
          aria-labelledby={restOn ? `${ids}-insights` : undefined}
        >
          <Stack spacing={3}>
            {baby && <BabyInsights key={baby.id} baby={baby} />}
            {babies && !baby && <InsightsComingCard />}
            <Box id="growth" sx={{ scrollMarginTop: 72 }}>
              <GrowthPage heading="h2" />
            </Box>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
