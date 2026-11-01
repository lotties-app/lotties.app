import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { canChangeEvent } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import { useEventsStartedSince } from '../db/hooks';
import type { Baby, EventType } from '../db/models';
import { CryAnswerRow } from '../events/CryAnswerRow';
import { cryAnswer } from '../events/cryDetection';
import { formatDuration, formatTime } from '../i18n/format';
import { setCryConfirmed } from './autoSpells';
import { recentDetections } from './monitorView';

const startOfToday = () => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
};

/**
 * "Recent detections": the monitor's spells of today with their time and length, and "Was she
 * crying?" so the parent can answer from the monitor's own device (the same answer as in the entry).
 */
export function RecentDetections({
  baby,
  types,
  headingLevel = 'h2',
}: {
  baby: Baby;
  types: readonly EventType[];
  headingLevel?: 'h2' | 'h3';
}) {
  const { t } = useTranslation();
  const db = useDatabase();
  const headingId = useId();
  const [from] = useState(startOfToday);
  const events = useEventsStartedSince(baby.id, from);
  if (!events) return null;
  const spells = recentDetections(events, types);
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ display: 'grid', gap: 1.5 }}>
      <Typography id={headingId} variant="subtitle1" component={headingLevel}>
        {t('cryMonitor.recent.title')}
      </Typography>
      {spells.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('cryMonitor.recent.empty')}
        </Typography>
      ) : (
        <Stack component="ul" spacing={2} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {spells.map((spell) => {
            const time = formatTime(spell.startedAt);
            return (
              <Box
                component="li"
                key={spell.id}
                data-testid="cry-detection"
                sx={{ display: 'grid', gap: 1 }}
              >
                <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {spell.endedAt === null
                    ? t('cryMonitor.recent.running', { time })
                    : t('cryMonitor.recent.ended', {
                        time,
                        duration: formatDuration(
                          Date.parse(spell.endedAt) - Date.parse(spell.startedAt),
                        ),
                      })}
                </Typography>
                <CryAnswerRow
                  answer={cryAnswer(spell)}
                  question={t('cryMonitor.answer.group', { time })}
                  {...(canChangeEvent(baby, spell)
                    ? { onAnswer: (crying: boolean) => void setCryConfirmed(db, spell.id, crying) }
                    : {})}
                />
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
