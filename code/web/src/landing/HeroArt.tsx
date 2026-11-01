import { Box } from '@mui/material';
import { Illustration } from '../ui/illustrations';

/**
 * The hero picture: the nap cloud with its moon and the bottle on a soft disc (the same pair the
 * Keycloak sign-in page shows). The glow comes from the illustrations and is off in the night
 * scheme, which is flat.
 */
export function HeroArt() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: 'relative',
        width: '100%',
        maxWidth: 360,
        aspectRatio: '1',
        mx: 'auto',
        borderRadius: '50%',
        bgcolor: (theme.vars ?? theme).palette.category.sleep.bg,
      })}
    >
      <Box
        sx={{
          position: 'absolute',
          left: '10%',
          top: '20%',
          width: '56%',
          lineHeight: 0,
          '& svg': { width: '100%', height: 'auto' },
        }}
      >
        <Illustration name="nap" size={180} glow />
      </Box>
      <Box
        sx={{
          position: 'absolute',
          right: '10%',
          bottom: '12%',
          width: '42%',
          lineHeight: 0,
          '& svg': { width: '100%', height: 'auto' },
        }}
      >
        <Illustration name="bottle" size={132} glow />
      </Box>
    </Box>
  );
}
