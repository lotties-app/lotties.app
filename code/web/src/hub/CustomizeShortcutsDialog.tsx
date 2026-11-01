import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Typography,
} from '@mui/material';
import { canBeShortcut, SHORTCUT_COUNT, type HubEntry, type HubEntryId } from './hubEntries';
import { setPinnedShortcuts } from './hubUsage';

interface Props {
  /** What the person can see; only care and family entries can be shortcuts. */
  entries: readonly HubEntry[];
  /** The shortcuts showing now (the starting selection). */
  current: readonly HubEntry[];
  onClose: () => void;
}

/** Pick up to four shortcuts, or hand the choice back to "by use". */
export function CustomizeShortcutsDialog({ entries, current, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [picked, setPicked] = useState<HubEntryId[]>(current.map((entry) => entry.id));
  const options = entries.filter(canBeShortcut);

  const toggle = (id: HubEntryId) =>
    setPicked((now) =>
      now.includes(id)
        ? now.filter((other) => other !== id)
        : now.length < SHORTCUT_COUNT
          ? [...now, id]
          : now,
    );
  const save = () => {
    setPinnedShortcuts(picked);
    onClose();
  };
  const automatic = () => {
    setPinnedShortcuts(null);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{t('hub.shortcuts.customizeTitle')}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {t('hub.shortcuts.customizeHint', { count: SHORTCUT_COUNT })}
        </Typography>
        <Typography variant="body2" role="status" sx={{ mb: 1, fontWeight: 600 }}>
          {t('hub.shortcuts.picked', { picked: picked.length, count: SHORTCUT_COUNT })}
        </Typography>
        <FormGroup>
          {options.map((entry) => {
            const checked = picked.includes(entry.id);
            return (
              <FormControlLabel
                key={entry.id}
                sx={{ minHeight: 44, mx: 0 }}
                control={
                  <Checkbox
                    checked={checked}
                    disabled={!checked && picked.length >= SHORTCUT_COUNT}
                    onChange={() => toggle(entry.id)}
                  />
                }
                label={t(`hub.entries.${entry.id}.title`)}
              />
            );
          })}
        </FormGroup>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={automatic} sx={{ minHeight: 44, mr: 'auto' }}>
          {t('hub.shortcuts.automatic')}
        </Button>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          {t('hub.shortcuts.cancel')}
        </Button>
        <Button variant="contained" onClick={save} sx={{ minHeight: 44 }}>
          {t('hub.shortcuts.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
