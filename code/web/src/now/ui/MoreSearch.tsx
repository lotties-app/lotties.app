import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { Icon } from '../../ui/Icon';

interface Props {
  query: string;
  onChange: (query: string) => void;
  /** Tiles matching the current query (shown and announced while one is typed). */
  resultCount: number;
}

/** A mouse or trackpad: focusing the field there does not open a keyboard over the sheet. */
function hasFinePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: fine)').matches
  );
}

/**
 * The More sheet search (docs/DESIGN.md "More sheet search"): sticky at the top of the sheet,
 * focused on open only with a fine pointer, Enter does nothing, the count is a live status.
 */
export function MoreSearch({ query, onChange, resultCount }: Props) {
  const { t } = useTranslation();
  const [autoFocus] = useState(hasFinePointer);
  const searching = query.trim() !== '';
  return (
    <Box
      component="form"
      role="search"
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Esc clears a typed query first; with none it reaches the sheet, which closes.
        if (e.key !== 'Escape' || !searching) return;
        e.preventDefault();
        e.stopPropagation();
        onChange('');
      }}
      sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', py: 1, my: -1 }}
    >
      <TextField
        type="search"
        fullWidth
        autoFocus={autoFocus}
        autoComplete="off"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('now.more.search.label')}
        slotProps={{
          htmlInput: {
            'aria-label': t('now.more.search.label'),
            enterKeyHint: 'search',
            autoCapitalize: 'off',
            spellCheck: false,
          },
          input: {
            // 16 px or more: iOS does not zoom into the field on focus.
            sx: { fontSize: '1rem' },
            startAdornment: (
              <InputAdornment position="start">
                <Icon name="search" size={20} />
              </InputAdornment>
            ),
            endAdornment: searching ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t('now.more.search.clear')}
                  onClick={() => onChange('')}
                  edge="end"
                  sx={{ width: 44, height: 44 }}
                >
                  <Icon name="close" size={20} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />
      <Typography
        role="status"
        variant="body2"
        color="text.secondary"
        sx={{ mt: searching ? 1 : 0, minHeight: 0 }}
      >
        {!searching
          ? ''
          : resultCount === 0
            ? t('now.more.search.none')
            : t('now.more.search.results', { count: resultCount })}
      </Typography>
    </Box>
  );
}
