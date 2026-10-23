import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useEventsStartedSince } from '../../db/hooks';
import type { BabyEvent, EventType } from '../../db/models';
import { currentLocale } from '../../i18n/i18n';
import { MORE_USAGE_WINDOW_DAYS, moreTileMatches, orderMoreTypes } from '../moreOrder';
import { presetLabel } from '../../presets/presetLabel';
import { PresetTile } from '../../presets/PresetTile';
import { presetsForBaby } from '../../presets/resolve';
import type { Preset } from '../../presets/types';
import type { PresetActions } from '../../presets/usePresetActions';
import { usePresetStates } from '../../presets/usePresetEvents';
import { CryReasonsButton } from './CryReasonsSheet';
import { MoreSearch } from './MoreSearch';
import { SheetFrame } from './SheetFrame';
import type { TrayName } from './trays';

interface Props {
  open: boolean;
  onClose: () => void;
  babyId: string;
  /** The signed-in person's server id (`Baby.userId`): her own events order the tiles. */
  userId: string | null | undefined;
  types: readonly EventType[];
  events: readonly BabyEvent[];
  actions: PresetActions;
  readOnly: boolean;
  /** Presets with their own tray open it instead of running (Diaper, Meds, Belly pain). */
  onOpenTray: (tray: TrayName) => void;
  /** Nursing starts the live timer through the Now commands. */
  onStartNursing: () => void;
  /** Opens "Why is she crying?" (on Now, for those who log); absent elsewhere. */
  onCryReasons?: () => void;
}

/** The Bottle preset is a timer (start, then stop with the amount), so it runs like the others. */
const TRAY_OF_PRESET: Readonly<Record<string, TrayName>> = {
  diaper: 'diaper',
  medication: 'meds',
  belly_pain: 'bellyPain',
};

/**
 * The tiles in the More sheet order (`orderMoreTypes`), worked out once when the sheet opens from
 * the person's events of the last 60 days, so nothing moves while it is open. `undefined` while
 * those events load (a single local read). A preset that appears later goes last.
 */
function useMoreOrder(
  babyId: string,
  userId: string | null | undefined,
  presets: Preset[],
): Preset[] | undefined {
  const [openedAt] = useState(() => new Date());
  const since = new Date(openedAt.getTime() - MORE_USAGE_WINDOW_DAYS * DAY_MS).toISOString();
  const usage = useEventsStartedSince(babyId, since);
  const [rank, setRank] = useState<string[] | null>(null);
  // Adjusted while rendering (not in an effect): the first render with the events has the order.
  if (rank === null && usage !== undefined) {
    setRank(ids(orderMoreTypes(presets, usage, userId, openedAt, currentLocale())));
  }
  if (rank === null) return undefined;
  const position = (p: Preset) => {
    const index = rank.indexOf(p.id);
    return index === -1 ? rank.length : index;
  };
  return [...presets].sort((a, b) => position(a) - position(b));
}

const DAY_MS = 24 * 3_600_000;
const ids = (presets: readonly Preset[]) => presets.map((p) => p.id);

/**
 * The More sheet: every preset of the baby as a two-column grid with its status line, so nothing
 * the baby can track is more than two taps away. The tiles the person logs most come first, the
 * rest by name (docs/DESIGN.md "More sheet order"). Sleep presets stay here as data kinds; the
 * toggle on Now is the everyday way.
 */
export function MoreSheet({
  open,
  onClose,
  babyId,
  userId,
  types,
  events,
  actions,
  readOnly,
  onOpenTray,
  onStartNursing,
  onCryReasons,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stateOf = usePresetStates(events);
  const allTypes = presetsForBaby([...types]);
  const ordered = useMoreOrder(babyId, userId, allTypes);
  // A new query each time the sheet opens: it mounts on open.
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const presets = searching
    ? ordered?.filter((preset) => moreTileMatches(query, presetLabel(preset)))
    : ordered;
  /** Esc clears a typed query first; with none it closes the sheet as usual. */
  const clearOnEscape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || !searching) return;
    e.stopPropagation();
    setQuery('');
  };

  const select = (preset: Preset, running?: BabyEvent) => {
    onClose();
    if (preset.mode === 'link') {
      if (preset.href) navigate(preset.href);
      return;
    }
    const tray = TRAY_OF_PRESET[preset.id];
    if (tray) onOpenTray(tray);
    else if (preset.id === 'nursing' && !running) onStartNursing();
    else if (preset.id === 'nursing') onOpenTray('feed');
    else void actions.run(preset, running);
  };

  return (
    <SheetFrame open={open} onClose={onClose} title={t('now.more.title')}>
      {allTypes.length > 0 && (
        <MoreSearch query={query} onChange={setQuery} resultCount={presets?.length ?? 0} />
      )}
      {allTypes.length === 0 ? (
        <Typography color="text.secondary">{t('home.noTypes')}</Typography>
      ) : (
        <Box
          data-testid="more-grid"
          onKeyDown={clearOnEscape}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}
        >
          {presets?.map((preset) => {
            const { status, running } = stateOf(preset);
            return (
              <PresetTile
                key={preset.id}
                preset={preset}
                status={status || undefined}
                running={running !== undefined}
                disabled={readOnly && preset.mode !== 'link'}
                onClick={() => select(preset, running)}
              />
            );
          })}
        </Box>
      )}
      {onCryReasons && !readOnly && (
        <CryReasonsButton
          onClick={() => {
            onClose();
            onCryReasons();
          }}
        />
      )}
    </SheetFrame>
  );
}
