import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { GuideSteps } from './GuideSteps';
import { guideView } from './guides';
import type { GuideId, InstallPlatform } from './installPlatform';

interface Props {
  open: boolean;
  onClose: () => void;
  guide: GuideId;
  platform: InstallPlatform;
  /** False on /install itself, where the full instructions are the page. */
  showFullGuideLink: boolean;
}

/**
 * The compact steps for a browser without an install prompt (iPhone and iPad, Firefox, a browser
 * that has not offered the prompt). A modal dialog: focus moves into it and stays there, Escape and
 * Close dismiss it. On a phone it sits at the bottom of the screen, near the browser's toolbar.
 */
export function InstallGuideSheet({ open, onClose, guide, platform, showFullGuideLink }: Props) {
  const { t } = useTranslation();
  const view = guideView(guide, platform);
  const ios = platform.os === 'ios';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="install-sheet-title"
      sx={{ '& .MuiDialog-container': { alignItems: { xs: 'flex-end', sm: 'center' } } }}
      slotProps={{ paper: { sx: { m: { xs: 1, sm: 4 }, width: { xs: 'calc(100% - 16px)' } } } }}
    >
      <DialogTitle id="install-sheet-title" component="h2">
        {ios ? t('install.sheet.titleIos') : t('install.sheet.title')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {ios && <Typography color="text.secondary">{t('install.sheet.iosHonest')}</Typography>}
          <GuideSteps hint={view.hint} steps={view.steps} />
          {ios && guide !== 'iosSafari' && (
            <Typography color="text.secondary">{t('install.sheet.safariTip')}</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
        {showFullGuideLink && (
          <Button component={RouterLink} to="/install" onClick={onClose} sx={{ minHeight: 44 }}>
            {t('install.fullGuide')}
          </Button>
        )}
        <Button variant="contained" onClick={onClose} sx={{ minHeight: 44 }}>
          {t('install.sheet.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
