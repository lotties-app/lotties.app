import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import { formatDuration, formatTime } from '../../i18n/format';
import { RADIUS, type CategoryName } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { palette } from '../../ui/form/styles';
import type { IconName } from '../../ui/icons';
import type { NowState } from '../nowState';
import { formatTileStatus, sleepActionLabel } from '../nowText';
import type { SleepActionKind } from '../sleepToggle';
import type { NowScreenModel } from '../useNow';
import { canKeepScreenOn, useWakeLock } from '../useWakeLock';
import { NursingCard } from './NursingCard';
import type { NowAction } from './useNowAction';

const MINUTE_MS = 60_000;

const ACTION_ICON: Record<SleepActionKind, IconName> = {
  fell_asleep: 'moon',
  bedtime: 'moon-stars',
  woke_up: 'sun',
  night_waking: 'eye',
  up_for_the_day: 'sun',
  back_asleep: 'moon',
};

interface Props {
  model: NowScreenModel;
  babyName: string;
  action: NowAction;
  onOpenFeed: () => void;
  onOpenDiaper: () => void;
}

function GiantButton({
  icon,
  category,
  title,
  subtitle,
  primary = false,
  disabled,
  onClick,
}: {
  icon: IconName;
  category: CategoryName;
  title: string;
  subtitle?: string;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={(theme) => ({
        width: '100%',
        minHeight: 120,
        p: 2.5,
        gap: 2.5,
        justifyContent: 'flex-start',
        textAlign: 'left',
        borderRadius: `${RADIUS.card + 4}px`,
        backgroundColor: primary ? palette(theme).primary.main : palette(theme).background.paper,
        color: primary ? palette(theme).primary.contrastText : palette(theme).text.primary,
        boxShadow: primary ? 'none' : `inset 0 0 0 1px ${palette(theme).hairline}`,
        '&.Mui-disabled': { opacity: 0.6 },
      })}
    >
      {primary ? (
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)',
          }}
        >
          <CategoryIcon
            name={icon}
            category={category}
            size={40}
            sx={{ backgroundColor: 'transparent', color: 'inherit', width: 'auto', height: 'auto' }}
          />
        </Box>
      ) : (
        <CategoryIcon name={icon} category={category} size={40} />
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="span" sx={{ display: 'block', color: 'inherit' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="caption"
            component="span"
            sx={{ display: 'block', color: 'inherit', opacity: 0.85 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}

type HeadlineKey =
  'now.state.awake' | 'now.state.asleepNap' | 'now.state.asleepNight' | 'now.state.nightWaking';

function headline(state: NowState): { key: HeadlineKey; minutes: number } | null {
  if (state.kind === 'awake') return { key: 'now.state.awake', minutes: state.awakeMinutes };
  if (state.kind !== 'asleep') return null;
  if (state.nightWaking)
    return { key: 'now.state.nightWaking', minutes: state.nightWaking.minutes };
  return {
    key: state.sleepKind === 'night' ? 'now.state.asleepNight' : 'now.state.asleepNap',
    minutes: state.minutes,
  };
}

/**
 * The night view of Now (docs/design/mockups/01-night-and-visit.html): a state line and three
 * giant buttons (Feed, Diaper, the sleep toggle), no cards or charts. A running nursing session
 * keeps its timers on screen. The screen is kept awake while this view is open.
 */
export function NightNow({ model, babyName, action, onOpenFeed, onOpenDiaper }: Props) {
  const { t } = useTranslation();
  useWakeLock(true);
  const { state, now } = model;
  const feed = model.tiles.find((tile) => tile.id === 'feed');
  const diaper = model.tiles.find((tile) => tile.id === 'diaper');
  const disabled = model.readOnly;
  const [primary, ...others] = model.sleepActions;
  const info = headline(state);
  const run = (kind: SleepActionKind) =>
    void action.run(() =>
      model.commands.sleep(kind, state.kind === 'asleep' ? undefined : state.sleepKindHint),
    );
  const nursing = feed?.running ?? null;

  return (
    <Box component="section" aria-label={t('now.night.region')} sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          {babyName}
        </Typography>
        {info ? (
          <>
            <Typography variant="h5" component="p">
              {t(info.key)}
            </Typography>
            <Typography variant="hero" component="p" data-testid="state-duration">
              {formatDuration(info.minutes * MINUTE_MS)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {state.kind === 'asleep' && state.nightWaking
                ? t('now.state.wakingSince', {
                    time: formatTime(state.nightWaking.since),
                    sleepTime: formatTime(state.since),
                  })
                : t('now.state.since', {
                    time: formatTime(state.kind === 'unknown' ? now : state.since),
                  })}
            </Typography>
          </>
        ) : (
          <Typography variant="h5" component="p">
            {t('now.ask.title', { name: babyName })}
          </Typography>
        )}
      </Box>

      {nursing ? (
        <NursingCard
          event={nursing}
          commands={model.commands}
          action={action}
          readOnly={model.readOnly}
          large
        />
      ) : (
        <GiantButton
          icon="bottle"
          category="feeding"
          title={t('now.tiles.feed')}
          subtitle={feed ? formatTileStatus(feed, now) : undefined}
          disabled={disabled || !model.trays.feed}
          onClick={onOpenFeed}
        />
      )}
      {model.trays.diaper && (
        <GiantButton
          icon="diaper"
          category="diaper"
          title={t('now.tiles.diaper')}
          subtitle={diaper ? formatTileStatus(diaper, now) : undefined}
          disabled={disabled}
          onClick={onOpenDiaper}
        />
      )}
      {primary && (
        <GiantButton
          primary
          icon={ACTION_ICON[primary.kind]}
          category="sleep"
          title={sleepActionLabel(primary.kind)}
          disabled={disabled}
          onClick={() => run(primary.kind)}
        />
      )}
      {others.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
          {others.map((other) => (
            <ButtonBase
              key={other.kind}
              disabled={disabled}
              onClick={() => run(other.kind)}
              sx={{
                minHeight: 64,
                px: 3,
                borderRadius: `${RADIUS.button}px`,
                color: 'text.secondary',
                fontWeight: 600,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {sleepActionLabel(other.kind)}
            </ButtonBase>
          ))}
        </Box>
      )}
      {canKeepScreenOn() && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          {t('now.night.screenOn')}
        </Typography>
      )}
    </Box>
  );
}
