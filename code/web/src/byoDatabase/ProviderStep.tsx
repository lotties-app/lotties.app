import { useTranslation } from 'react-i18next';
import {
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { ProviderGuide } from './ProviderGuide';
import { PROVIDERS, type ProviderId } from './providers';

/** Step 1: pick where the database runs. Supabase and Neon are examples; prices are the provider's. */
export function ProviderStep({
  provider,
  onChange,
}: {
  provider: ProviderId;
  onChange: (provider: ProviderId) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="body2">{t('byoDatabase.provider.intro')}</Typography>
      <FormControl>
        <FormLabel id="byo-provider-label">{t('byoDatabase.provider.label')}</FormLabel>
        <RadioGroup
          aria-labelledby="byo-provider-label"
          value={provider}
          onChange={(event) => {
            const next = PROVIDERS.find((p) => p === event.target.value);
            if (next) onChange(next);
          }}
        >
          {PROVIDERS.map((id) => (
            <FormControlLabel
              key={id}
              value={id}
              control={<Radio />}
              label={
                <Stack sx={{ py: 0.5 }}>
                  <Typography variant="body1">
                    {t(`byoDatabase.provider.options.${id}.name`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`byoDatabase.provider.options.${id}.hint`)}
                  </Typography>
                </Stack>
              }
              sx={{ alignItems: 'flex-start', '& .MuiRadio-root': { mt: 0.25 } }}
            />
          ))}
        </RadioGroup>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        {t('byoDatabase.provider.prices')}
      </Typography>
      <ProviderGuide provider={provider} />
    </Stack>
  );
}
