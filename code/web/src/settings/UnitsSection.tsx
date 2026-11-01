import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { UNIT_SETTINGS, isUnitSetting } from '../units/system';
import { useUnitSettings } from '../units/useUnits';

/**
 * Measurement units of the signed-in account: automatic (the device's region), metric or US
 * customary. Only what is shown and typed changes; the saved values stay metric.
 */
export function UnitsSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setting, system, pending, setSetting } = useUnitSettings();
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t('units.hint')}
      </Typography>
      <FormControl>
        <FormLabel id="units-group-label">{t('units.groupLabel')}</FormLabel>
        <RadioGroup
          aria-labelledby="units-group-label"
          value={setting}
          onChange={(e) => {
            if (!isUnitSetting(e.target.value)) return;
            setSetting(e.target.value);
            // The screens redraw in the new system: land back on this open section.
            void navigate({ hash: '#units' }, { replace: true });
          }}
        >
          {UNIT_SETTINGS.map((choice) => (
            <FormControlLabel
              key={choice}
              value={choice}
              control={<Radio />}
              sx={{ alignItems: 'flex-start', py: 0.5 }}
              label={
                <Stack>
                  <Typography>{t(`units.${choice}.label`)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {choice === 'auto'
                      ? t('units.auto.hint', { system: t(`units.system.${system}`) })
                      : t(`units.${choice}.hint`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`units.${choice}.example`)}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>
        {pending && <FormHelperText role="status">{t('units.pending')}</FormHelperText>}
      </FormControl>
    </Stack>
  );
}
