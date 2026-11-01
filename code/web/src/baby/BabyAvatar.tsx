import { Avatar } from '@mui/material';
import { babyColor, babyInitial } from './babyColor';

/** Initial on a colour derived from the baby id (photo support later). */
export function BabyAvatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <Avatar
      aria-hidden
      sx={{
        width: size,
        height: size,
        bgcolor: babyColor(id),
        color: '#fff',
        fontSize: size * 0.45,
        fontWeight: 500,
      }}
    >
      {babyInitial(name)}
    </Avatar>
  );
}
