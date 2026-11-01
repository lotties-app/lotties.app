import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  ButtonBase,
  Popover,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { BabyEvent, EventType, Medication, Prescription } from '../db/models';
import { useEventTypeText } from '../i18n/eventTypeText';
import { SheetFrame } from '../now/ui/SheetFrame';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { focusRing, palette } from '../ui/form/styles';
import { formatTime } from '../i18n/format';
import { eventWhen, presentSafely } from './ribbonText';

/** What the detail shows: the events behind a mark and, for a counted mark, the one picked. */
export interface RibbonDetailTarget {
  anchor: HTMLElement;
  events: BabyEvent[];
  /** Index of the event shown; `null` lists the events of a counted mark. */
  index: number | null;
}

interface Props {
  target: RibbonDetailTarget;
  onPick: (index: number | null) => void;
  onClose: () => void;
  types: readonly EventType[];
  medications: Medication[];
  prescriptions?: Prescription[];
  now: Date;
  /** Events that have a row in the list below (a night that began yesterday has none). */
  listedIds: ReadonlySet<string>;
  /** Opens the event in the edit sheet; omitted for viewers. */
  onOpen?: (event: BabyEvent) => void;
  onShowInList: (event: BabyEvent) => void;
}

const pillButton = { minHeight: 44, borderRadius: `${RADIUS.pill}px`, px: 2 } as const;

/**
 * The detail of a ribbon mark: anchored to it in a small popover on wider screens, a compact
 * bottom sheet on phones. One event shows its icon, title, time (range and length) and details
 * with Open and Show in list; a counted mark lists its events first. Esc closes and gives the
 * focus back to the mark (the modal does both).
 */
export function RibbonDetail(props: Props) {
  const { target, onClose } = props;
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('sm'));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const titleId = useId();
  const heading = useHeading(props);

  const body = <DetailBody {...props} />;
  if (!wide) {
    return (
      <SheetFrame
        open
        onClose={onClose}
        title={heading.title}
        {...(heading.subtitle ? { subtitle: heading.subtitle } : {})}
        leading={heading.leading}
      >
        {body}
      </SheetFrame>
    );
  }
  return (
    <Popover
      open
      anchorEl={target.anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      transitionDuration={reducedMotion ? 0 : 'auto'}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': titleId,
          sx: {
            p: 2,
            width: 320,
            maxWidth: 'calc(100vw - 32px)',
            borderRadius: `${RADIUS.card}px`,
            backgroundImage: 'none',
          },
        },
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {heading.leading}
          <Box sx={{ minWidth: 0 }}>
            <Typography id={titleId} component="h2" sx={{ fontWeight: 600 }}>
              {heading.title}
            </Typography>
            {heading.subtitle && (
              <Typography variant="caption" color="text.secondary" component="p">
                {heading.subtitle}
              </Typography>
            )}
          </Box>
        </Stack>
        {body}
      </Stack>
    </Popover>
  );
}

/** Title, subtitle (type name when the title says something else) and icon of the detail. */
function useHeading({ target, types, medications, prescriptions }: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  if (target.index === null) {
    return {
      title: t('day.ribbon.clusterTitle', { count: target.events.length }),
      subtitle: t('day.ribbon.range', {
        from: formatTime(target.events[0].startedAt),
        to: formatTime(target.events[target.events.length - 1].startedAt),
      }),
      leading: null,
    };
  }
  const event = target.events[target.index];
  const type = types.find((candidate) => candidate.id === event.typeId);
  const view = presentSafely(event, type, medications, names, prescriptions);
  const typeName = type ? names.typeName(type) : '';
  return {
    title: view.title,
    subtitle: typeName && typeName !== view.title ? typeName : undefined,
    leading: <CategoryIcon name={view.icon} category={view.category} size={20} />,
  };
}

function DetailBody(props: Props) {
  const { target, onPick } = props;
  if (target.index === null) {
    return <ClusterList {...props} onPick={onPick} />;
  }
  return <EventDetail {...props} event={target.events[target.index]} />;
}

function ClusterList({ target, onPick, types, medications, prescriptions }: Props) {
  const names = useEventTypeText();
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}>
      {target.events.map((event, index) => {
        const type = types.find((candidate) => candidate.id === event.typeId);
        const view = presentSafely(event, type, medications, names, prescriptions);
        const time = formatTime(event.startedAt);
        return (
          <li key={event.id}>
            <ButtonBase
              onClick={() => onPick(index)}
              sx={(theme) => ({
                width: '100%',
                minHeight: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 1.25,
                px: 1,
                borderRadius: `${RADIUS.input}px`,
                textAlign: 'start',
                font: 'inherit',
                '&:hover': { backgroundColor: palette(theme).surfaceRaised },
                '&:focus-visible': { outline: focusRing(theme), outlineOffset: 0 },
              })}
            >
              <CategoryIcon name={view.icon} category={view.category} size={16} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {view.title}
                </Typography>
                {view.detail && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="p"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {view.detail}
                  </Typography>
                )}
              </Box>
              <Typography
                component="time"
                dateTime={event.startedAt}
                variant="body2"
                sx={{ fontVariantNumeric: 'lining-nums tabular-nums', flexShrink: 0 }}
              >
                {time}
              </Typography>
              <Icon name="chevron-right" size={16} />
            </ButtonBase>
          </li>
        );
      })}
    </Box>
  );
}

function EventDetail({
  event,
  target,
  onPick,
  onClose,
  types,
  medications,
  prescriptions,
  now,
  listedIds,
  onOpen,
  onShowInList,
}: Props & { event: BabyEvent }) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const type = types.find((candidate) => candidate.id === event.typeId);
  const view = presentSafely(event, type, medications, names, prescriptions);
  const when = eventWhen(event, type, t, now);
  const listed = listedIds.has(event.id);
  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography sx={{ fontVariantNumeric: 'lining-nums tabular-nums' }}>
          {when.time}
          {when.duration && (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {` · ${when.duration}`}
            </Box>
          )}
        </Typography>
        {view.detail && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {view.detail}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end' }}>
        {target.events.length > 1 && (
          <Button
            onClick={() => onPick(null)}
            startIcon={<Icon name="chevron-left" size={20} />}
            sx={{ ...pillButton, mr: 'auto', px: 1.5 }}
          >
            {t('common.back')}
          </Button>
        )}
        {listed && (
          <Button
            variant="outlined"
            onClick={() => {
              onClose();
              onShowInList(event);
            }}
            sx={pillButton}
          >
            {t('day.ribbon.showInList')}
          </Button>
        )}
        {onOpen && (
          <Button
            variant="contained"
            onClick={() => {
              onClose();
              onOpen(event);
            }}
            sx={pillButton}
          >
            {t('day.ribbon.open')}
          </Button>
        )}
      </Box>
    </Stack>
  );
}
