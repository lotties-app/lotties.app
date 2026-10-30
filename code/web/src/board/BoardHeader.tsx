import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { describeApiError } from '../api/errorMessages';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { createItem, type BoardTopic } from './boardApi';
import { boardErrorOverrides } from './boardErrors';
import { sortTopics, type QuickAddDefaults } from './boardQuery';

/** Search waits this long after the last key before it asks the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The search field: debounced, the text is the `q` filter of the URL. */
export function BoardSearch({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const value = draft ?? q;
  const commit = (next: string) => {
    window.clearTimeout(timer.current);
    setDraft(null);
    if (next !== q) onSearch(next);
  };
  return (
    <Box
      component="form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(value);
      }}
    >
      <TextField
        id="board-search"
        type="search"
        fullWidth
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(next), SEARCH_DEBOUNCE_MS);
        }}
        placeholder={t('board.search.placeholder')}
        slotProps={{
          htmlInput: { 'aria-label': t('board.search.label'), enterKeyHint: 'search' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Icon name="search" size={20} />
              </InputAdornment>
            ),
            endAdornment: value ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t('board.search.clear')}
                  onClick={() => commit('')}
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
    </Box>
  );
}

interface QuickAddProps {
  defaults: QuickAddDefaults;
  topics: readonly BoardTopic[];
  onTopic: (key: string) => void;
  onAdded: (title: string) => void;
  /** Opens the full form with what was typed. */
  onMore: (title: string) => void;
}

/**
 * One-line add (Enter): the title, in the view's type and side, into the chosen topic (the
 * filtered one, else the last used). "More fields" opens the full form with the same start.
 */
export function QuickAdd({ defaults, topics, onTopic, onAdded, onMore }: QuickAddProps) {
  const { t } = useTranslation();
  const api = useApiClient();
  const hintId = useId();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = sortTopics(topics).filter((topic) => !topic.archived);

  const add = async () => {
    const text = title.trim();
    if (!text || !defaults.topic || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createItem(api, {
        id: crypto.randomUUID(),
        title: text.slice(0, 200),
        type: defaults.type,
        side: defaults.side,
        topic: defaults.topic,
      });
      setTitle('');
      onAdded(text);
    } catch (failure) {
      setError(describeApiError(failure, boardErrorOverrides()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="form"
      aria-label={t('board.quickAdd.label')}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'flex-start' } }}
      >
        <TextField
          id="board-quick-add"
          label={t('board.quickAdd.title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(`board.quickAdd.placeholders.${defaults.type}`)}
          disabled={busy}
          sx={{ flex: 2, minWidth: 0 }}
          slotProps={{
            htmlInput: {
              'aria-describedby': hintId,
              maxLength: 200,
              enterKeyHint: 'done',
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="add" size={20} />
                </InputAdornment>
              ),
              sx: { minHeight: 48 },
            },
          }}
        />
        <TextField
          select
          label={t('board.quickAdd.topic')}
          value={defaults.topic ?? ''}
          onChange={(e) => onTopic(e.target.value)}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {open.map((topic) => (
            <MenuItem key={topic.key} value={topic.key} sx={{ minHeight: 44 }}>
              {topic.name}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1}>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !title.trim() || !defaults.topic}
            sx={{ minHeight: 48, flex: { xs: 1, sm: 'none' } }}
          >
            {t('board.quickAdd.add')}
          </Button>
          <Button
            onClick={() => onMore(title.trim())}
            sx={{ minHeight: 48, flex: { xs: 1, sm: 'none' }, whiteSpace: 'nowrap' }}
          >
            {t('board.quickAdd.more')}
          </Button>
        </Stack>
      </Stack>
      <Typography
        id={hintId}
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mt: 0.5 }}
      >
        {/* One sentence per type (article and gender in each language), the side as a phrase. */}
        {t(`board.quickAdd.hints.${defaults.type}`, {
          side: t(`board.quickAdd.forSide.${defaults.side}`),
        })}
      </Typography>
      {error && (
        <Typography variant="body2" color="error" role="alert">
          {error}
        </Typography>
      )}
    </Box>
  );
}
