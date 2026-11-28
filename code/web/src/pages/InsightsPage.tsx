import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import { DaySummaryView } from '../daySummary/DaySummaryView';
import type { WeightPoint } from '../insights/formulaComparison';
import { InsightsComingCard, InsightsSection } from '../insights/InsightsSection';
import { useMeasurements } from '../measurements/useMeasurements';
import { RestOptInCard } from '../rest/RestOptInCard';
import { RestTab } from '../rest/RestTab';
import { RhythmSection } from '../rhythm/RhythmSection';
import { useRestSettings } from '../rest/useRest';
import { GrowthPage } from './GrowthPage';

/**
 * The selected baby's insights with the measured weights (online; the Formulas ml per kg), then
 * her rhythm from the server (docs/design/48-baby-rhythm.md; hidden on 403/404).
 */
function BabyInsights({ baby }: { baby: Baby }) {
  const { query } = useMeasurements(baby.id);
  const weights: WeightPoint[] = (query.data ?? []).flatMap((m) =>
    typeof m.weightKg === 'number' ? [{ date: m.date, kg: m.weightKg }] : [],
  );
  return (
    <Stack spacing={3}>
      <InsightsSection baby={baby} weights={weights} />
      <RhythmSection babyId={baby.id} babyName={baby.name} />
    </Stack>
  );
}

type InsightsTab = 'insights' | 'day' | 'rest';

/**
 * Insights (third tab): the sleep, feeding and diaper insights of the selected baby, worked out
 * from the local data (each one opens after a few days with data, with a progress row and an
 * estimate until then), and Growth under its own heading. With a baby, a second tab, Day, sums up
 * one day at a glance (docs/DESIGN.md "Day summary"). When the person has turned the rest estimate
 * on (docs/design/41-caregiver-rest.md) a last tab, Rest, appears; until then a small opt-in card
 * offers it. Insights stays the first tab and the default.
 */
export function InsightsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const { query: restSettings } = useRestSettings();
  const [tab, setTab] = useState<InsightsTab>('insights');
  const ids = useId();
  // "Add measurements" after a visit links here (`#growth`): bring Growth into view, back on the
  // Insights tab when another one was open.
  const { hash } = useLocation();
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    if (hash === '#growth') setTab('insights');
  }
  useEffect(() => {
    if (hash === '#growth') document.getElementById('growth')?.scrollIntoView?.({ block: 'start' });
  }, [hash, baby, tab]);
  const rest = restSettings.data ?? null;
  const restOn = rest?.enabled === true;
  const dayOn = Boolean(baby);
  const active: InsightsTab =
    (tab === 'rest' && restOn) || (tab === 'day' && dayOn) ? tab : 'insights';
  const tabbed = dayOn || restOn;
  const panel = (name: InsightsTab) => ({
    role: 'tabpanel',
    id: `${ids}-${name}-panel`,
    'aria-labelledby': `${ids}-${name}`,
  });
  const tabProps = (name: InsightsTab) => ({
    value: name,
    id: `${ids}-${name}`,
    'aria-controls': `${ids}-${name}-panel`,
    sx: { minHeight: 48 },
  });
  const tabs = { insights: tabProps('insights'), day: tabProps('day'), rest: tabProps('rest') };
  const panels = { day: panel('day'), rest: panel('rest') };
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        {t('nav.insights')}
      </Typography>
      {rest && !restOn && <RestOptInCard settings={rest} />}
      {tabbed && (
        <Tabs
          value={active}
          onChange={(_, next: InsightsTab) => setTab(next)}
          aria-label={t('rest.tabsLabel')}
          variant="fullWidth"
        >
          <Tab {...tabs.insights} label={t('nav.insights')} />
          {dayOn && <Tab {...tabs.day} label={t('daySummary.tab')} />}
          {restOn && <Tab {...tabs.rest} label={t('rest.tab')} />}
        </Tabs>
      )}
      {active === 'rest' && rest ? (
        <Box {...panels.rest}>
          <RestTab settings={rest} />
        </Box>
      ) : active === 'day' && baby ? (
        <Box {...panels.day}>
          <DaySummaryView key={baby.id} baby={baby} />
        </Box>
      ) : (
        <Box
          role={tabbed ? 'tabpanel' : undefined}
          id={`${ids}-insights-panel`}
          aria-labelledby={tabbed ? `${ids}-insights` : undefined}
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
