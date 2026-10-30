import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Icon } from '../ui/Icon';
import type { BoardTopic } from './boardApi';
import { ADMIN_PANELS, type AdminPanel } from './boardQuery';
import { KeysPanel } from './KeysPanel';
import { TopicsPanel } from './TopicsPanel';

interface Props {
  panel: AdminPanel;
  onPanel: (panel: AdminPanel) => void;
  onClose: () => void;
  topics: readonly BoardTopic[];
  announce: (message: string) => void;
  now: number;
}

/** The board's settings for admins (`?panel=keys|topics`): API keys and topics. */
export function AdminDialog({ panel, onPanel, onClose, topics, announce, now }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const tabId = (name: AdminPanel) => `${titleId}-tab-${name}`;
  const panelId = (name: AdminPanel) => `${titleId}-panel-${name}`;
  return (
    <Dialog
      open
      fullScreen={phone}
      fullWidth
      maxWidth="md"
      onClose={onClose}
      aria-labelledby={titleId}
      scroll="paper"
    >
      <DialogTitle
        id={titleId}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
      >
        {t('board.admin.title')}
        <IconButton
          aria-label={t('board.drawer.close')}
          onClick={onClose}
          sx={{ width: 44, height: 44 }}
        >
          <Icon name="close" size={20} />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={panel}
          onChange={(_, next: AdminPanel) => onPanel(next)}
          aria-label={t('board.admin.title')}
          variant="fullWidth"
        >
          {ADMIN_PANELS.map((name) => (
            <Tab
              key={name}
              value={name}
              id={tabId(name)}
              aria-controls={panelId(name)}
              label={t(`board.admin.${name}`)}
              sx={{ minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Box>
      <DialogContent>
        <Box role="tabpanel" id={panelId(panel)} aria-labelledby={tabId(panel)}>
          {panel === 'keys' ? (
            <KeysPanel topics={topics} announce={announce} now={now} />
          ) : (
            <TopicsPanel announce={announce} />
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
