import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  IconButton,
  Popover,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import { useCatchUpOffer, type CatchUpOffer } from '../catchUpSlot';
import { CatchUpContent } from './CatchUpContent';
import { SheetFrame } from './SheetFrame';

/** Badge cap: more shows "9+". */
const BADGE_MAX = 9;

function CatchUpPopover({
  offer,
  anchor,
  onClose,
}: {
  offer: CatchUpOffer;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Popover
      open={anchor !== null}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': titleId,
          sx: (theme) => ({
            mt: 1,
            p: 2.5,
            width: 'min(400px, calc(100vw - 24px))',
            maxHeight: 'min(80dvh, 560px)',
            borderRadius: `${RADIUS.card}px`,
            boxShadow: palette(theme).navShadow,
            '[data-dark] &': { backgroundColor: palette(theme).surfaceRaised },
          }),
        },
      }}
    >
      <Typography id={titleId} variant="h5" component="h2" sx={{ mb: 1.5 }}>
        {t('now.catchUp.title')}
      </Typography>
      <CatchUpContent
        catchUp={offer.catchUp}
        babyName={offer.babyName}
        types={offer.types}
        onDone={offer.acknowledge}
      />
    </Popover>
  );
}

/**
 * Header button of the hand-over catch-up ("Since you last looked", docs/design/21-hub.md): shown
 * only while the Now screen offers one (others logged something since this device last showed
 * the baby), with a count badge of the new entries. It opens the summary in a popover on wide
 * screens and a bottom sheet on phones; "Got it" marks it seen (the button goes away), while
 * closing or Esc leaves it for later. No animation: the badge only appears.
 */
export function CatchUpButton({ babyId }: { babyId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('sm'));
  const offer = useCatchUpOffer();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const shown = offer !== null && offer.babyId === babyId;
  // Nothing new any more (Got it, another baby, left Now): the sheet closes with the button.
  if (!shown && anchor !== null) setAnchor(null);
  if (!shown) return null;
  const count = offer.catchUp.total;
  const label = t('now.catchUp.button', { count });
  const close = () => setAnchor(null);
  const seen: CatchUpOffer = {
    ...offer,
    acknowledge: () => {
      close();
      offer.acknowledge();
    },
  };

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          color="inherit"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={anchor !== null}
          data-testid="catch-up-button"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ width: 44, height: 44 }}
        >
          <Badge
            badgeContent={count}
            max={BADGE_MAX}
            color="primary"
            data-testid="catch-up-badge"
            sx={{ '& .MuiBadge-badge': { transition: 'none' } }}
          >
            <Icon name="history" />
          </Badge>
        </IconButton>
      </Tooltip>
      {wide ? (
        <CatchUpPopover offer={seen} anchor={anchor} onClose={close} />
      ) : (
        <SheetFrame open={anchor !== null} onClose={close} title={t('now.catchUp.title')}>
          <CatchUpContent
            catchUp={offer.catchUp}
            babyName={offer.babyName}
            types={offer.types}
            onDone={seen.acknowledge}
          />
        </SheetFrame>
      )}
    </>
  );
}
