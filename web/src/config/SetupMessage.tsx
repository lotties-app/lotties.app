import { Box, Container, Typography } from '@mui/material';

export function SetupMessage({ missing }: { missing: string[] }) {
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Setup required
      </Typography>
      <Typography gutterBottom>
        Baby Routine is not configured. Set the following environment variables (see
        web/.env.example) and restart:
      </Typography>
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
