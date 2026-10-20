import { Typography } from '@mui/material';

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary">Placeholder: {note}</Typography>
    </>
  );
}
