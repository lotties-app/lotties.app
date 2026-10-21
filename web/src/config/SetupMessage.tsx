import { Box, Container, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function SetupMessage({ missing }: { missing: string[] }) {
  const { t } = useTranslation();
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h5" component="h1" gutterBottom>
        {t('auth.setupTitle')}
      </Typography>
      <Typography gutterBottom>{t('auth.setupBody')}</Typography>
      <Box component="ul">
        {missing.map((key) => (
          <li key={key}>
            <code>{key}</code>
          </li>
        ))}
      </Box>
    </Container>
  );
}
