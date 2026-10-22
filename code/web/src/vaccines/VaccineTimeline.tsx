import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { DoseCard } from './DoseCard';
import {
  groupByAge,
  isListed,
  type AgeGroup,
  type DoseView,
  type VaccineFilter,
} from './vaccineModel';
import type { VaccineSchedule } from './vaccineSchedule';
import { ageLabel } from './vaccineText';

export interface TimelineHandlers {
  onRecord: (view: DoseView) => void;
  onSchedule: (view: DoseView) => void;
  onEdit: (recordId: string) => void;
  onDelete: (recordId: string) => void;
}

interface Props extends TimelineHandlers {
  /** Every dose of the schedule (the cards look at their alternatives among them). */
  views: readonly DoseView[];
  schedule: VaccineSchedule;
  filter: VaccineFilter;
  /** The local calendar date `yyyy-mm-dd`. */
  today: string;
  writable: boolean;
}

interface SectionProps extends Props {
  group: AgeGroup;
}

function AgeSection({ group, views, ...card }: SectionProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Box component="section" aria-labelledby={titleId} sx={{ display: 'grid', gap: 1 }}>
      <Typography id={titleId} variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {ageLabel(t, group.bucket)}
      </Typography>
      <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
        {group.views.map((view) => (
          <DoseCard key={view.dose.doseId} view={view} views={views} {...card} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * The schedule as a timeline grouped by recommended age (at birth, 1 month, 2 months, ...), one card
 * per dose that the filter lists.
 */
export function VaccineTimeline(props: Props) {
  const { t } = useTranslation();
  const groups = groupByAge(props.views.filter((view) => isListed(view, props.filter)));
  if (groups.length === 0) {
    return <Typography color="text.secondary">{t('vaccines.timeline.none')}</Typography>;
  }
  return (
    <Stack spacing={2.5} role="group" aria-label={t('vaccines.timeline.label')}>
      {groups.map((group) => (
        <AgeSection key={group.key} group={group} {...props} />
      ))}
    </Stack>
  );
}
