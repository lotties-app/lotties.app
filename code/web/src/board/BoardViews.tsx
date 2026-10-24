import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Link,
  Typography,
} from '@mui/material';
import { formatDate } from '../i18n/format';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import {
  BOARD_PRIORITIES,
  BOARD_STATUSES,
  CLOSED_STATUSES,
  type BoardCount,
  type BoardItemSummary,
  type BoardStatus,
  type BoardTopic,
} from './boardApi';
import { sortTopics, type BoardFilters } from './boardQuery';
import { ItemRow } from './ItemRow';
import { MarkdownView } from './MarkdownView';
import { useBoardLinks } from './useBoardLinks';

export interface ViewProps {
  items: readonly BoardItemSummary[];
  topics: readonly BoardTopic[];
  counts: readonly BoardCount[];
  filters: BoardFilters;
  selectedId: string | undefined;
  now: number;
  /** Shows one topic's items (a decision's topic link). */
  onTopic: (key: string) => void;
}

function RowList({
  items,
  selectedId,
  now,
  hideSide = false,
}: Pick<ViewProps, 'selectedId' | 'now'> & {
  items: readonly BoardItemSummary[];
  hideSide?: boolean;
}) {
  return (
    <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 0.25 }}>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          selected={item.id === selectedId}
          hideSide={hideSide}
          now={now}
        />
      ))}
    </Box>
  );
}

const byTopic = (items: readonly BoardItemSummary[], key: string) =>
  items.filter((item) => item.topic === key);

/** Topics as sections (accordions) with their counts by status and the matching items. */
export function TopicsView({ items, topics, counts, filters, selectedId, now }: ViewProps) {
  const { t } = useTranslation();
  const shown = sortTopics(topics).filter(
    (topic) =>
      (filters.topic.length === 0 || filters.topic.includes(topic.key)) &&
      (!topic.archived || byTopic(items, topic.key).length > 0),
  );
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {shown.map((topic) => {
        const own = byTopic(items, topic.key);
        const statusCounts = BOARD_STATUSES.map((status) => ({
          status,
          count: counts
            .filter((c) => c.topic === topic.key && c.status === status)
            .reduce((sum, c) => sum + c.count, 0),
        })).filter(
          ({ status, count }) =>
            count > 0 && !(filters.hideClosed && CLOSED_STATUSES.includes(status)),
        );
        return (
          <TopicSection
            key={topic.key}
            topic={topic}
            counts={statusCounts}
            defaultExpanded={own.length > 0}
          >
            {own.length > 0 ? (
              <RowList items={own} selectedId={selectedId} now={now} />
            ) : (
              <Typography color="text.secondary" sx={{ px: 1.5 }}>
                {t('board.views.topicEmpty')}
              </Typography>
            )}
          </TopicSection>
        );
      })}
    </Box>
  );
}

function TopicSection({
  topic,
  counts,
  defaultExpanded,
  children,
}: {
  topic: BoardTopic;
  counts: { status: BoardStatus; count: number }[];
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      slotProps={{ heading: { component: 'h2' }, transition: { unmountOnExit: true } }}
      sx={{ borderRadius: '16px !important', '&::before': { display: 'none' } }}
    >
      <AccordionSummary
        id={`${id}-header`}
        aria-controls={`${id}-content`}
        expandIcon={<Icon name="expand" size={20} />}
        sx={{ minHeight: 56, '& .MuiAccordionSummary-content': { minWidth: 0 } }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" sx={{ display: 'block', fontWeight: 600 }}>
            {topic.name}
            {topic.archived && ` · ${t('board.views.archived')}`}
          </Typography>
          <Box
            component="span"
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              mt: 0.25,
              fontSize: '0.8125rem',
              color: 'text.secondary',
            }}
          >
            {counts.length === 0
              ? t('board.views.noOpen')
              : counts.map(({ status, count }) => (
                  <span key={status}>
                    {t('board.views.statusCount', {
                      count,
                      status: t(`board.statuses.${status}`),
                    })}
                  </span>
                ))}
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails id={`${id}-content`} sx={{ px: 0.5, pb: 1 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

/** One side's items (Mine, Claude): a plain list, most urgent first. */
export function SideView({ items, selectedId, now }: ViewProps) {
  return <RowList items={items} selectedId={selectedId} now={now} hideSide />;
}

/** Decisions as a log by date: the summary, the rationale on demand, a link to the topic. */
export function DecisionsView({ items, topics, onTopic }: ViewProps) {
  const groups = new Map<string, BoardItemSummary[]>();
  for (const item of items) {
    const day = (item.decision?.decidedAt ?? item.updatedAt).slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {[...groups.entries()].map(([day, entries]) => (
        <Box key={day}>
          <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            <time dateTime={day}>{formatDate(day)}</time>
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
            {entries.map((item) => (
              <DecisionEntry key={item.id} item={item} topics={topics} onTopic={onTopic} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function DecisionEntry({
  item,
  topics,
  onTopic,
}: {
  item: BoardItemSummary;
  topics: readonly BoardTopic[];
  onTopic: (key: string) => void;
}) {
  const { t } = useTranslation();
  const links = useBoardLinks();
  const [open, setOpen] = useState(false);
  const rationaleId = useId();
  const topic = topics.find((candidate) => candidate.key === item.topic);
  return (
    <Box
      component="li"
      sx={(theme) => ({
        listStyle: 'none',
        p: 1.5,
        borderRadius: '16px',
        backgroundColor: palette(theme).background.paper,
        boxShadow: palette(theme).cardShadow,
      })}
    >
      <Link
        component={RouterLink}
        to={links.item(item.id)}
        data-board-row={item.id}
        sx={{ fontWeight: 600, overflowWrap: 'anywhere', display: 'inline-block', minHeight: 24 }}
      >
        {item.title}
      </Link>
      {item.decision?.summary && (
        <Typography sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {item.decision.summary}
        </Typography>
      )}
      <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Chip
          size="small"
          variant="outlined"
          label={topic?.name ?? item.topic}
          onClick={() => onTopic(item.topic)}
          aria-label={t('board.views.showTopic', { topic: topic?.name ?? item.topic })}
        />
        {item.decision?.rationale && (
          <Button
            size="small"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={rationaleId}
            endIcon={<Icon name={open ? 'collapse' : 'expand'} size={16} />}
            sx={{ minHeight: 44 }}
          >
            {t('board.views.rationale')}
          </Button>
        )}
      </Box>
      {item.decision?.rationale && (
        <Typography
          id={rationaleId}
          hidden={!open}
          color="text.secondary"
          sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {item.decision.rationale}
        </Typography>
      )}
    </Box>
  );
}

/** Gaps by topic, then by priority (urgent first). */
export function GapsView({ items, topics, selectedId, now }: ViewProps) {
  const { t } = useTranslation();
  const known = sortTopics(topics);
  const keys = [
    ...known.map((topic) => topic.key),
    ...new Set(items.map((item) => item.topic).filter((key) => !known.some((k) => k.key === key))),
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {keys.map((key) => {
        const own = byTopic(items, key);
        if (own.length === 0) return null;
        const name = known.find((topic) => topic.key === key)?.name ?? key;
        return (
          <Box key={key}>
            <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
              {name}
            </Typography>
            {[...BOARD_PRIORITIES].reverse().map((priority) => {
              const level = own.filter((item) => item.priority === priority);
              if (level.length === 0) return null;
              return (
                <Box key={priority} sx={{ mt: 1 }}>
                  <Typography
                    component="h3"
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontWeight: 600, px: 1.5 }}
                  >
                    {t(`board.priorities.${priority}`)}
                  </Typography>
                  <RowList items={level} selectedId={selectedId} now={now} />
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

/** Notes and memories: pinned first, tags as chips, a Markdown preview of the start of the body. */
export function NotesView({ items }: ViewProps) {
  const { t } = useTranslation();
  const links = useBoardLinks();
  const ordered = [...items.filter((item) => item.pinned), ...items.filter((item) => !item.pinned)];
  return (
    <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
      {ordered.map((item) => (
        <Box
          component="li"
          key={item.id}
          sx={(theme) => ({
            listStyle: 'none',
            p: 1.5,
            borderRadius: '16px',
            backgroundColor: palette(theme).background.paper,
            boxShadow: palette(theme).cardShadow,
          })}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ pt: '2px', color: 'text.secondary', display: 'flex' }}>
              <Icon
                name={item.pinned ? 'pin' : item.type === 'memory' ? 'bookmark' : 'note'}
                size={20}
                label={item.pinned ? t('board.row.pinned') : t(`board.types.${item.type}`)}
              />
            </Box>
            <Link
              component={RouterLink}
              to={links.item(item.id)}
              data-board-row={item.id}
              sx={{ fontWeight: 600, overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}
            >
              {item.title}
            </Link>
          </Box>
          {item.labels.length > 0 && (
            <Box sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {item.labels.map((label) => (
                <Chip key={label} size="small" variant="outlined" label={label} />
              ))}
            </Box>
          )}
          {item.excerpt?.trim() && (
            <Box sx={{ mt: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
              <MarkdownView source={item.excerpt} />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
