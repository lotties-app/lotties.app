import { Stack } from '@mui/material';
import type { RestSettings } from './restApi';
import { RestEstimateCard } from './RestEstimateCard';
import { RestHistorySection } from './RestHistorySection';
import { RestSettingsEditor } from './RestSettingsEditor';

/** The Rest tab of Insights: last night, the morning question, the history and the person's own settings. */
export function RestTab({ settings }: { settings: RestSettings }) {
  return (
    <Stack spacing={3}>
      <RestEstimateCard />
      <RestHistorySection />
      <RestSettingsEditor settings={settings} />
    </Stack>
  );
}
