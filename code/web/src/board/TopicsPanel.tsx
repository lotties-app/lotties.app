import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { describeApiError } from '../api/errorMessages';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { upsertTopic, type BoardTopic } from './boardApi';
import { useBoardRefresh, useBoardTopics } from './boardData';
import { boardErrorOverrides } from './boardErrors';
import { sortTopics, TOPIC_KEY_PATTERN } from './boardQuery';

/** Admins: rename, describe, reorder and archive topics, or add one (`PUT /board/topics/{key}`). */
export function TopicsPanel({ announce }: { announce: (message: string) => void }) {
  const { t } = useTranslation();
  const topics = useBoardTopics(true);
  if (topics.isPending) {
    return (
      <Stack spacing={1} aria-busy="true">
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={64} />
      </Stack>
    );
  }
  if (topics.isError) {
    return <Alert severity="error">{describeApiError(topics.error, boardErrorOverrides())}</Alert>;
  }
  const sorted = sortTopics(topics.data);
  const nextOrder = (sorted.at(-1)?.sortOrder ?? 0) + 10;
  return (
    <Stack spacing={3}>
      <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
        {sorted.map((topic) => (
          <TopicRow
            key={`${topic.key}-${topic.name}-${topic.sortOrder}-${topic.archived}`}
            topic={topic}
            announce={announce}
          />
        ))}
      </Box>
      <NewTopic
        nextOrder={nextOrder}
        announce={announce}
        taken={sorted.map((topic) => topic.key)}
      />
      <Typography variant="body2" color="text.secondary">
        {t('board.topics.note')}
      </Typography>
    </Stack>
  );
}

function TopicRow({ topic, announce }: { topic: BoardTopic; announce: (message: string) => void }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const refresh = useBoardRefresh();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.name);
  const [description, setDescription] = useState(topic.description ?? '');
  const [order, setOrder] = useState(String(topic.sortOrder));
  const [archived, setArchived] = useState(topic.archived);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await upsertTopic(api, topic.key, {
        name: name.trim(),
        description: description.trim() || null,
        sortOrder: Number.parseInt(order, 10) || 0,
        archived,
      });
      await refresh.topics();
      announce(t('board.topics.saved', { name: name.trim() }));
      setEditing(false);
    } catch (error) {
      setFailure(describeApiError(error, boardErrorOverrides()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="li"
      sx={(theme) => ({
        listStyle: 'none',
        p: 1.5,
        borderRadius: '16px',
        backgroundColor: palette(theme).surfaceRaised,
      })}
    >
      {editing ? (
        <Box
          component="form"
          noValidate
          aria-label={t('board.topics.editLabel', { name: topic.name })}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Stack spacing={1.5}>
            {failure && (
              <Alert severity="error" role="alert">
                {failure}
              </Alert>
            )}
            <TextField
              label={t('board.topics.name')}
              value={name}
              required
              error={!name.trim()}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label={t('board.topics.description')}
              value={description}
              multiline
              onChange={(e) => setDescription(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <TextField
              type="number"
              label={t('board.topics.order')}
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'numeric', step: 10 } }}
            />
            <FormControlLabel
              control={
                <Switch checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              }
              label={t('board.topics.archived')}
              sx={{ minHeight: 44 }}
            />
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 44 }}>
                {t('board.drawer.save')}
              </Button>
              <Button onClick={() => setEditing(false)} sx={{ minHeight: 44 }}>
                {t('board.drawer.cancel')}
              </Button>
            </Stack>
          </Stack>
        </Box>
      ) : (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
              {topic.name}
              {topic.archived && ` · ${t('board.views.archived')}`}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {topic.description
                ? t('board.topics.keyAndDescription', {
                    key: topic.key,
                    description: topic.description,
                  })
                : topic.key}
            </Typography>
          </Box>
          <Button
            onClick={() => setEditing(true)}
            startIcon={<Icon name="edit" size={20} />}
            aria-label={t('board.topics.editLabel', { name: topic.name })}
            sx={{ minHeight: 44 }}
          >
            {t('board.drawer.edit')}
          </Button>
        </Stack>
      )}
    </Box>
  );
}

function NewTopic({
  nextOrder,
  taken,
  announce,
}: {
  nextOrder: number;
  taken: readonly string[];
  announce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const refresh = useBoardRefresh();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyError = touched
    ? !TOPIC_KEY_PATTERN.test(key)
      ? t('board.topics.keyInvalid')
      : taken.includes(key)
        ? t('board.topics.keyTaken')
        : null
    : null;
  const nameError = touched && !name.trim();

  const add = async () => {
    setTouched(true);
    if (!TOPIC_KEY_PATTERN.test(key) || taken.includes(key) || !name.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await upsertTopic(api, key, { name: name.trim(), sortOrder: nextOrder });
      await refresh.topics();
      announce(t('board.topics.added', { name: name.trim() }));
      setKey('');
      setName('');
      setTouched(false);
    } catch (error) {
      setFailure(describeApiError(error, boardErrorOverrides()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="form"
      noValidate
      aria-labelledby="board-topic-new"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Typography component="h3" variant="subtitle1" id="board-topic-new" sx={{ mb: 1 }}>
        {t('board.topics.newTitle')}
      </Typography>
      <Stack spacing={1.5}>
        {failure && (
          <Alert severity="error" role="alert">
            {failure}
          </Alert>
        )}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
          <TextField
            label={t('board.topics.key')}
            value={key}
            required
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            error={!!keyError}
            helperText={keyError ?? t('board.topics.keyHelp')}
            slotProps={{ htmlInput: { maxLength: 40, autoCapitalize: 'none', spellCheck: false } }}
          />
          <TextField
            label={t('board.topics.name')}
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            helperText={nameError ? t('board.topics.nameRequired') : undefined}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
        </Box>
        <Button
          type="submit"
          variant="contained"
          disabled={busy}
          startIcon={<Icon name="add" size={20} />}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t('board.topics.add')}
        </Button>
      </Stack>
    </Box>
  );
}
