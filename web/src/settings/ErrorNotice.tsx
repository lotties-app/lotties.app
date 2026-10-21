import { Alert } from '@mui/material';

export function ErrorNotice({ message }: { message: string | null }) {
  return message ? <Alert severity="error">{message}</Alert> : null;
}
