import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useDatabase } from '../db/DatabaseContext';
import { recordBottleLevel } from '../db/eventCommands';
import { SheetFrame } from '../now/ui/SheetFrame';
import { NumberStepper } from '../ui/form';
import { BottleLevelChips } from './BottleLevelChips';
import { dismissBottleLevel, useBottleLevelPrompt, type BottleLevelPrompt } from './bottleLevelPrompt';
import { MAX_LEVEL_ML } from './bottleSegments';

const STEP_ML = 10;

function LevelSheet({ prompt }: { prompt: BottleLevelPrompt }) {
  const { t } = useTranslation();
  const db = useDatabase();
  const [other, setOther] = useState<number | null>(null);
  const close = () => dismissBottleLevel(prompt.id);
  const record = (leftMl: number) => {
    close();
    // Optional detail: a failure (the bottle was deleted meanwhile) only loses the answer.
    void recordBottleLevel(db, prompt.eventId, leftMl, prompt.count).catch(() => undefined);
  };
  const max = prompt.ceilingMl ?? prompt.preparedMl ?? MAX_LEVEL_ML;
  return (
    <SheetFrame open onClose={close} title={t('feedingAmounts.level.title')}>
      <Typography variant="body2" color="text.secondary">
        {t('feedingAmounts.level.hint')}
      </Typography>
      <BottleLevelChips
        aria-label={t('feedingAmounts.level.chips')}
        preparedMl={prompt.preparedMl}
        ceilingMl={prompt.ceilingMl}
        value={null}
        onChange={record}
      />
      <Stack spacing={1}>
        <Typography variant="overline" component="p" color="text.secondary">
          {t('feedingAmounts.level.other')}
        </Typography>
        <NumberStepper
          aria-label={t('feedingAmounts.level.other')}
          value={other}
          onChange={setOther}
          step={STEP_ML}
          min={0}
          max={max}
          unit="ml"
          {...(prompt.ceilingMl !== null ? { start: prompt.ceilingMl } : {})}
        />
      </Stack>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button onClick={close} sx={{ minHeight: 44, flex: 1 }}>
          {t('feedingAmounts.level.skip')}
        </Button>
        <Button
          variant="contained"
          disabled={other === null}
          onClick={() => other !== null && record(other)}
          sx={{ minHeight: 44, flex: 1 }}
        >
          {t('feedingAmounts.level.save')}
        </Button>
      </Box>
    </SheetFrame>
  );
}

/**
 * "How much is left in the bottle?" after a bottle is paused: quick chips relative to the prepared
 * amount (only the stepper when it is unknown), Save for the stepper, Skip. Tapping outside, Esc
 * or Skip close it; the pause was saved before it opened. Mounted once in the app shell.
 */
export function BottleLevelPromptHost() {
  const prompt = useBottleLevelPrompt();
  return prompt ? <LevelSheet key={prompt.id} prompt={prompt} /> : null;
}
