import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '../ui/Icon';
import {
  BOARD_PRIORITIES,
  BOARD_SIDES,
  BOARD_STATUSES,
  BOARD_TYPES,
  type BoardTopic,
} from './boardApi';
import { sortTopics } from './boardQuery';
import {
  canPin,
  FORM_FIELDS,
  isDecision,
  LIMITS,
  type FormErrors,
  type FormField,
  type ItemFormState,
} from './itemFormModel';
import { MarkdownView } from './MarkdownView';

interface Props {
  value: ItemFormState;
  onChange: (next: ItemFormState) => void;
  topics: readonly BoardTopic[];
  errors: FormErrors;
  /** A field the server refused (its `field`), shown at that field. */
  serverField?: string | null;
  /** Autofocus the title (a new item). */
  autoFocusTitle?: boolean;
}

const TWO_COLUMNS = { display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } } as const;

/** Every editable field of an item, labels above (the theme shrinks them), errors under each. */
export function ItemForm({ value, onChange, topics, errors, serverField, autoFocusTitle }: Props) {
  const { t } = useTranslation();
  const bodyId = useId();
  const [preview, setPreview] = useState(false);
  const set = <K extends keyof ItemFormState>(key: K, next: ItemFormState[K]) =>
    onChange({ ...value, [key]: next });
  // The message under each field: the form's own check, else the server's refusal of it.
  const messages: Partial<Record<FormField, string>> = {};
  for (const field of FORM_FIELDS) {
    const code = errors[field];
    if (code) messages[field] = t(`board.form.errors.${code}`);
    else if (serverField === field) messages[field] = t('board.form.errors.server');
  }
  // Archived topics are offered only to keep an item that already sits in one.
  const topicOptions = sortTopics(topics).filter(
    (topic) => !topic.archived || topic.key === value.topic,
  );

  return (
    <Stack spacing={2}>
      <TextField
        label={t('board.form.title')}
        value={value.title}
        required
        autoFocus={autoFocusTitle}
        onChange={(e) => set('title', e.target.value)}
        error={!!messages.title}
        helperText={messages.title}
        slotProps={{ htmlInput: { maxLength: LIMITS.title } }}
      />
      <Box sx={TWO_COLUMNS}>
        <TextField
          select
          label={t('board.form.type')}
          value={value.type}
          onChange={(e) => set('type', e.target.value as ItemFormState['type'])}
        >
          {BOARD_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {t(`board.types.${type}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('board.form.topic')}
          value={value.topic}
          required
          onChange={(e) => set('topic', e.target.value)}
          error={!!messages.topic}
          helperText={messages.topic}
        >
          {topicOptions.map((topic) => (
            <MenuItem key={topic.key} value={topic.key}>
              {topic.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
        <TextField
          select
          label={t('board.form.status')}
          value={value.status}
          onChange={(e) => set('status', e.target.value as ItemFormState['status'])}
        >
          {BOARD_STATUSES.map((status) => (
            <MenuItem key={status} value={status}>
              {t(`board.statuses.${status}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('board.form.side')}
          value={value.side}
          onChange={(e) => set('side', e.target.value as ItemFormState['side'])}
        >
          {BOARD_SIDES.map((side) => (
            <MenuItem key={side} value={side}>
              {t(`board.sides.${side}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('board.form.priority')}
          value={value.priority}
          onChange={(e) => set('priority', e.target.value as ItemFormState['priority'])}
        >
          {BOARD_PRIORITIES.map((priority) => (
            <MenuItem key={priority} value={priority}>
              {t(`board.priorities.${priority}`)}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={TWO_COLUMNS}>
        <TextField
          type="date"
          label={t('board.form.dueDate')}
          value={value.dueDate}
          onChange={(e) => set('dueDate', e.target.value)}
          error={!!messages.dueDate}
          helperText={messages.dueDate}
        />
        <TextField
          label={t('board.form.labels')}
          value={value.labels}
          onChange={(e) => set('labels', e.target.value)}
          error={!!messages.labels}
          helperText={messages.labels ?? t('board.form.labelsHelp')}
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
        />
      </Box>

      {canPin(value.type) && (
        <FormControlLabel
          control={
            <Switch checked={value.pinned} onChange={(e) => set('pinned', e.target.checked)} />
          }
          label={t('board.form.pinned')}
          sx={{ minHeight: 44 }}
        />
      )}

      {isDecision(value.type) && (
        <>
          <TextField
            label={t('board.form.decisionSummary')}
            value={value.decisionSummary}
            multiline
            minRows={2}
            onChange={(e) => set('decisionSummary', e.target.value)}
            error={!!messages.decisionSummary}
            helperText={messages.decisionSummary}
            slotProps={{ htmlInput: { maxLength: LIMITS.decisionSummary } }}
          />
          <TextField
            label={t('board.form.rationale')}
            value={value.rationale}
            multiline
            minRows={2}
            onChange={(e) => set('rationale', e.target.value)}
            error={!!messages.rationale}
            helperText={messages.rationale}
            slotProps={{ htmlInput: { maxLength: LIMITS.rationale } }}
          />
        </>
      )}

      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          {t('board.form.links')}
        </Typography>
        <Stack spacing={1.5}>
          {value.links.map((link, index) => (
            <Box
              key={index}
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) minmax(0, 2fr) auto' },
                alignItems: 'start',
              }}
            >
              <TextField
                label={t('board.form.linkLabel')}
                value={link.label}
                onChange={(e) =>
                  set(
                    'links',
                    value.links.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)),
                  )
                }
                slotProps={{ htmlInput: { maxLength: LIMITS.linkLabel } }}
              />
              <TextField
                type="url"
                label={t('board.form.linkUrl')}
                value={link.url}
                onChange={(e) =>
                  set(
                    'links',
                    value.links.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)),
                  )
                }
                sx={{ gridColumn: { xs: '1 / 2', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' } }}
                slotProps={{ htmlInput: { maxLength: LIMITS.linkUrl, spellCheck: false } }}
              />
              <IconButton
                aria-label={t('board.form.removeLink', { index: index + 1 })}
                onClick={() =>
                  set(
                    'links',
                    value.links.filter((_, i) => i !== index),
                  )
                }
                sx={{ width: 44, height: 44, mt: 3 }}
              >
                <Icon name="delete" size={20} />
              </IconButton>
            </Box>
          ))}
          {messages.links && (
            <Typography variant="body2" color="error" role="alert">
              {messages.links}
            </Typography>
          )}
          {value.links.length < LIMITS.links && (
            <Button
              onClick={() => set('links', [...value.links, { label: '', url: 'https://' }])}
              startIcon={<Icon name="add" size={20} />}
              sx={{ alignSelf: 'flex-start', minHeight: 44 }}
            >
              {t('board.form.addLink')}
            </Button>
          )}
        </Stack>
      </Box>

      <TextField
        label={t('board.form.source')}
        value={value.source}
        onChange={(e) => set('source', e.target.value)}
        error={!!messages.source}
        helperText={messages.source ?? t('board.form.sourceHelp')}
        slotProps={{ htmlInput: { maxLength: LIMITS.source } }}
      />

      <Box>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}
        >
          <Typography component="label" htmlFor={bodyId} variant="body2" sx={{ fontWeight: 600 }}>
            {t('board.form.body')}
          </Typography>
          <Button
            size="small"
            onClick={() => setPreview((on) => !on)}
            aria-pressed={preview}
            sx={{ minHeight: 44 }}
          >
            {t('board.form.preview')}
          </Button>
        </Stack>
        {preview ? (
          <Box
            sx={{ p: 1.5, borderRadius: '14px', bgcolor: 'action.hover', minHeight: 96 }}
            aria-label={t('board.form.previewLabel')}
            role="region"
          >
            {value.body.trim() ? (
              <MarkdownView source={value.body} />
            ) : (
              <Typography color="text.secondary">{t('board.form.previewEmpty')}</Typography>
            )}
          </Box>
        ) : (
          <TextField
            id={bodyId}
            value={value.body}
            multiline
            minRows={5}
            fullWidth
            onChange={(e) => set('body', e.target.value)}
            error={!!messages.body}
            helperText={messages.body ?? t('board.form.bodyHelp')}
            slotProps={{ htmlInput: { maxLength: LIMITS.body } }}
          />
        )}
      </Box>
    </Stack>
  );
}
