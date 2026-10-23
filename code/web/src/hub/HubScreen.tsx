import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { CustomizeShortcutsDialog } from './CustomizeShortcutsDialog';
import { HUB_SECTIONS, visibleEntries, type HubContext, type HubEntry } from './hubEntries';
import { pickShortcuts, useHubPrefs } from './hubUsage';
import { HubRow, ShortcutTile } from './HubRow';
import { entryMatches } from './searchEntries';
import { useHubAttention } from './useHubAttention';

/**
 * The Hub (docs/design/20-hub.md): the places that are not a daily tab, in three sections (baby
 * care, family, app), with a search field, four shortcuts picked by use (or by hand) and a badge
 * on what waits for a look. Role-aware: an entry the person cannot use is not listed.
 */
export function HubScreen({ context }: { context: HubContext }) {
  const { t } = useTranslation();
  const prefs = useHubPrefs();
  const attention = useHubAttention(context.baby);
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [customizing, setCustomizing] = useState(false);

  const visible = visibleEntries(context);
  const shortcuts = pickShortcuts(visible, prefs);
  const searching = query.trim() !== '';
  const matching = searching
    ? visible.filter((entry) =>
        entryMatches(
          query,
          t(`hub.entries.${entry.id}.title`),
          t(`hub.entries.${entry.id}.hint`),
          t(`hub.entries.${entry.id}.keywords`),
        ),
      )
    : visible;
  const bySection = (id: HubEntry['section']) => matching.filter((entry) => entry.section === id);

  return (
    <Stack spacing={3}>
      <Typography variant="h5" component="h1">
        {t('hub.title')}
      </Typography>

      <Box component="form" role="search" onSubmit={(e) => e.preventDefault()}>
        <TextField
          id={searchId}
          type="search"
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('hub.search.placeholder')}
          slotProps={{
            htmlInput: { 'aria-label': t('hub.search.label'), enterKeyHint: 'search' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="search" size={20} />
                </InputAdornment>
              ),
              endAdornment: searching ? (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={t('hub.search.clear')}
                    onClick={() => setQuery('')}
                    edge="end"
                    sx={{ width: 44, height: 44 }}
                  >
                    <Icon name="close" size={20} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
              sx: { minHeight: 48, borderRadius: `${RADIUS.input}px` },
            },
          }}
        />
        {searching && (
          <Typography role="status" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {matching.length === 0
              ? t('hub.search.none', { query: query.trim() })
              : t('hub.search.results', { count: matching.length })}
          </Typography>
        )}
      </Box>

      {!searching && shortcuts.length > 0 && (
        <Box component="section" aria-labelledby="hub-shortcuts-title">
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
          >
            <Typography variant="h6" component="h2" id="hub-shortcuts-title">
              {t('hub.shortcuts.title')}
            </Typography>
            <Button
              onClick={() => setCustomizing(true)}
              aria-haspopup="dialog"
              sx={{ minHeight: 44 }}
            >
              {t('hub.shortcuts.customize')}
            </Button>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 1.5,
            }}
          >
            {shortcuts.map((entry) => (
              <ShortcutTile
                key={entry.id}
                entry={entry}
                attention={attention.counts[entry.id] ?? 0}
              />
            ))}
          </Box>
        </Box>
      )}

      {HUB_SECTIONS.map((section) => {
        const entries = bySection(section);
        if (entries.length === 0) return null;
        const headingId = `hub-section-${section}`;
        return (
          <Box component="section" key={section} aria-labelledby={headingId}>
            <Typography variant="h6" component="h2" id={headingId} sx={{ mb: 1 }}>
              {t(`hub.sections.${section}`)}
            </Typography>
            <Paper
              component="ul"
              sx={{ borderRadius: `${RADIUS.card}px`, overflow: 'hidden', m: 0, p: 0 }}
            >
              {entries.map((entry) => (
                <HubRow key={entry.id} entry={entry} attention={attention.counts[entry.id] ?? 0} />
              ))}
            </Paper>
          </Box>
        );
      })}

      {customizing && (
        <CustomizeShortcutsDialog
          entries={visible}
          current={shortcuts}
          onClose={() => setCustomizing(false)}
        />
      )}
    </Stack>
  );
}
