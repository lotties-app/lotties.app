import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { useDatabase } from '../../db/DatabaseContext';
import { recordBottleLevel } from '../../db/eventCommands';
import { BottleLevelChips } from '../../events/BottleLevelChips';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { Illustration } from '../../ui/illustrations';
import { bottleFollowUp, bottleFollowUpDismissal } from '../bottleFollowUp';
import type { NowScreenModel } from '../useNow';

interface Props {
  babyId: string;
  babyName: string;
  model: Pick<NowScreenModel, 'events' | 'types' | 'now' | 'readOnly' | 'access'>;
}

/**
 * The follow-up after a sleep stopped a bottle (docs/design/20-feeding-amounts.md section 5): a
 * small calm row under "Running now" with the left-in-bottle chips and Skip. Shown once per bottle,
 * only to who may change it; answering or skipping removes it for good.
 */
export function BottleFollowUpRow({ babyId, babyName, model }: Props) {
  const { t } = useTranslation();
  const db = useDatabase();
  const [dismissed, setDismissed] = useState(() => bottleFollowUpDismissal.read(babyId));
  const [busy, setBusy] = useState(false);
  const followUp = bottleFollowUp(model.events, model.types, model.now, dismissed);
  if (!followUp || model.readOnly || !model.access.canChange(followUp.event)) return null;
  const { event } = followUp;
  const skip = () => {
    bottleFollowUpDismissal.write(babyId, event.id);
    setDismissed(event.id);
  };
  const answer = (leftMl: number) => {
    setBusy(true);
    // The row disappears once the bottle has its amount; a failure leaves it to try again.
    void recordBottleLevel(db, event.id, leftMl, followUp.count)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const title = t('feedingAmounts.followUp.title', { name: babyName });
  return (
    <Box
      role="group"
      aria-label={title}
      data-testid="bottle-follow-up"
      sx={(theme) => ({
        p: 1.5,
        borderRadius: `${RADIUS.input}px`,
        backgroundColor: palette(theme).surfaceRaised,
        boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
        <Illustration name="bottle" size={32} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('feedingAmounts.followUp.question')}
          </Typography>
        </Box>
      </Box>
      <BottleLevelChips
        aria-label={t('feedingAmounts.level.chips')}
        preparedMl={followUp.preparedMl}
        ceilingMl={followUp.ceilingMl}
        value={null}
        disabled={busy}
        onChange={answer}
      />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
        <Button size="small" color="inherit" onClick={skip} sx={{ minHeight: 44 }}>
          {t('feedingAmounts.followUp.dismiss')}
        </Button>
      </Box>
    </Box>
  );
}
