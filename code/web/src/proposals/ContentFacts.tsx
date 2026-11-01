import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import type { PrescriptionContent } from '../db/models';
import { PlainSummary } from '../medications/EditorShell';
import { summaryText } from '../medications/prescriptionForm';
import { courseText } from './proposalText';

/** One labelled fact: a small muted label and its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
        {label}
      </Typography>
      <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * What a prescription says, read back in plain words: the summary of the dose and the schedule, the
 * course and the doctor's instructions. Used for a suggestion and for the original of a prescription
 * a parent changed. It only repeats what the doctor wrote; it never judges the dose.
 */
export function ContentFacts({ content }: { content: PrescriptionContent }) {
  const { t } = useTranslation();
  return (
    <>
      <PlainSummary text={summaryText(content)} />
      <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.75 }}>
        <Fact label={t('proposals.facts.course')}>
          <Typography>{courseText(content)}</Typography>
        </Fact>
        {content.instructions && (
          <Fact label={t('proposals.facts.instructions')}>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{content.instructions}</Typography>
          </Fact>
        )}
      </Box>
    </>
  );
}
