import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControlLabel,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { formatList } from '../i18n/format';
import { SegmentedControl } from '../ui/form';
import { Icon } from '../ui/Icon';
import {
  BOARD_PRIORITIES,
  BOARD_SIDES,
  BOARD_SORTS,
  BOARD_STATUSES,
  type BoardTopic,
} from './boardApi';
import {
  activeFilterCount,
  BOARD_VIEWS,
  DEFAULT_FILTERS,
  hidesClosed,
  LABEL_PATTERN,
  sideIsFree,
  sortTopics,
  typesOf,
  type BoardFilters,
  type BoardView,
} from './boardQuery';

interface Option {
  value: string;
  label: string;
}

/** A select of several codes, shown as a list of their names ("Any" when none). */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly Option[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const nameOf = (code: string) => options.find((option) => option.value === code)?.label ?? code;
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(event) => {
        const raw = event.target.value as unknown;
        const next = typeof raw === 'string' ? raw.split(',') : (raw as string[]);
        // Keep the canonical order of the options.
        onChange(options.map((option) => option.value).filter((code) => next.includes(code)));
      }}
      slotProps={{
        select: {
          multiple: true,
          displayEmpty: true,
          renderValue: (selected) => {
            const codes = selected as string[];
            return codes.length === 0 ? t('board.filters.any') : formatList(codes.map(nameOf));
          },
        },
      }}
      sx={{ minWidth: 0 }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value} sx={{ minHeight: 44 }}>
          <Checkbox checked={value.includes(option.value)} sx={{ p: 0.5, mr: 1 }} />
          <ListItemText primary={option.label} />
        </MenuItem>
      ))}
    </TextField>
  );
}

interface Props {
  filters: BoardFilters;
  topics: readonly BoardTopic[];
  canAdmin: boolean;
  onChange: (next: BoardFilters) => void;
}

/**
 * The view switch (Topics, Mine, Claude, Decisions, Gaps, Notes and memories) and the filter
 * row: type, status, side, priority, topic, label, order, "Hide done and dropped" (on by default)
 * and, for admins, "Show deleted". Everything is written to the URL by the page.
 */
export function BoardFilterBar({ filters, topics, canAdmin, onChange }: Props) {
  const { t } = useTranslation();
  const panelId = useId();
  const count = activeFilterCount(filters);
  const [open, setOpen] = useState(count > 0);
  // What is typed in the label field until it is applied (Enter or leaving the field).
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const labelText = labelDraft ?? filters.label.join(', ');
  const set = (patch: Partial<BoardFilters>) => onChange({ ...filters, ...patch });
  const types = typesOf(filters.view);

  const applyLabels = () => {
    setLabelDraft(null);
    const labels = [
      ...new Set(
        labelText
          .split(/[,\s]+/)
          .map((label) => label.trim().toLowerCase())
          .filter((label) => LABEL_PATTERN.test(label)),
      ),
    ].slice(0, 10);
    if (labels.join(',') !== filters.label.join(',')) set({ label: labels });
  };

  return (
    <Stack spacing={1.5}>
      <SegmentedControl<BoardView>
        aria-label={t('board.views.label')}
        value={filters.view}
        onChange={(view) =>
          view &&
          onChange({
            ...DEFAULT_FILTERS,
            view,
            q: filters.q,
            topic: filters.topic,
            deleted: filters.deleted,
          })
        }
        options={BOARD_VIEWS.map((view) => ({ value: view, label: t(`board.views.${view}`) }))}
      />
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          startIcon={<Icon name="filter" size={20} />}
          sx={{ minHeight: 44 }}
        >
          {count > 0 ? t('board.filters.toggleCount', { count }) : t('board.filters.toggle')}
        </Button>
        {hidesClosed(filters.view) && (
          <FormControlLabel
            control={
              <Switch
                checked={filters.hideClosed}
                onChange={(event) => set({ hideClosed: event.target.checked })}
              />
            }
            label={t('board.filters.hideClosed')}
            sx={{ minHeight: 44, mr: 0 }}
          />
        )}
        {canAdmin && (
          <FormControlLabel
            control={
              <Switch
                checked={filters.deleted}
                onChange={(event) => set({ deleted: event.target.checked })}
              />
            }
            label={t('board.filters.showDeleted')}
            sx={{ minHeight: 44, mr: 0 }}
          />
        )}
        {count > 0 && (
          <Button
            onClick={() =>
              onChange({
                ...DEFAULT_FILTERS,
                view: filters.view,
                q: filters.q,
                deleted: filters.deleted,
                hideClosed: filters.hideClosed,
              })
            }
            sx={{ minHeight: 44 }}
          >
            {t('board.filters.clear')}
          </Button>
        )}
      </Stack>
      <Collapse in={open} id={panelId} unmountOnExit>
        <Box
          role="group"
          aria-label={t('board.filters.label')}
          sx={{
            display: 'grid',
            gap: 2,
            pt: 1,
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
          }}
        >
          {types.length > 1 && (
            <MultiSelect
              label={t('board.fields.type')}
              options={types.map((type) => ({ value: type, label: t(`board.types.${type}`) }))}
              value={filters.type}
              onChange={(type) => set({ type: type as BoardFilters['type'] })}
            />
          )}
          <MultiSelect
            label={t('board.fields.status')}
            options={BOARD_STATUSES.map((status) => ({
              value: status,
              label: t(`board.statuses.${status}`),
            }))}
            value={filters.status}
            onChange={(status) => set({ status: status as BoardFilters['status'] })}
          />
          {sideIsFree(filters.view) && (
            <MultiSelect
              label={t('board.fields.side')}
              options={BOARD_SIDES.map((side) => ({
                value: side,
                label: t(`board.sides.${side}`),
              }))}
              value={filters.side}
              onChange={(side) => set({ side: side as BoardFilters['side'] })}
            />
          )}
          <MultiSelect
            label={t('board.fields.priority')}
            options={BOARD_PRIORITIES.map((priority) => ({
              value: priority,
              label: t(`board.priorities.${priority}`),
            }))}
            value={filters.priority}
            onChange={(priority) => set({ priority: priority as BoardFilters['priority'] })}
          />
          <MultiSelect
            label={t('board.fields.topic')}
            options={sortTopics(topics).map((topic) => ({ value: topic.key, label: topic.name }))}
            value={filters.topic}
            onChange={(topic) => set({ topic })}
          />
          <TextField
            label={t('board.fields.labels')}
            value={labelText}
            onChange={(event) => setLabelDraft(event.target.value)}
            onBlur={applyLabels}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLabels();
              }
            }}
            helperText={t('board.filters.labelsHelp')}
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
          />
          <TextField
            select
            label={t('board.filters.sort')}
            value={filters.sort ?? ''}
            onChange={(event) =>
              set({ sort: (event.target.value || null) as BoardFilters['sort'] })
            }
            slotProps={{ select: { displayEmpty: true } }}
          >
            <MenuItem value="" sx={{ minHeight: 44 }}>
              {t('board.filters.sortDefault')}
            </MenuItem>
            {BOARD_SORTS.map((sort) => (
              <MenuItem key={sort} value={sort} sx={{ minHeight: 44 }}>
                {t(`board.sorts.${sort}`)}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Collapse>
    </Stack>
  );
}
