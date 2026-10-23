import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useEventsStartedSince } from '../../db/hooks';
import type { BabyEvent, EventType } from '../../db/models';
import type { PredictionsDto } from '../../sync/contract';
import { RADIUS } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { Icon } from '../../ui/Icon';
import { optionBase, palette } from '../../ui/form/styles';
import {
  CRY_RED_FLAGS,
  cryOutcomeHistory,
  rankCryReasons,
  type CryCause,
  type CryCauseRank,
  type CryLevel,
  type CryOutcomeHistory,
} from '../cryReasons';
import { causeName, factSentences, levelLabel, redFlagText, tryText } from '../cryReasonsText';
import { whatWorkedChips, type WhatWorkedChip } from '../crySpell';
import { DAY_MS, HOUR_MS } from '../eventFacts';
import { whatWorkedLabel } from '../nowText';
import { SheetFrame } from './SheetFrame';

/** Answered spells needed before "Helped 3 of your last 5 times" shows. */
const MIN_ANSWERED_SPELLS = 3;
/** How far back the outcome hint looks for answered fussy spells. */
const HISTORY_DAYS = 14;

/** A cause's shortcut to an existing tray or action (the caller closes this sheet). */
export interface CryShortcut {
  label: string;
  run: () => void;
}

export interface CryAnswerChoice {
  openedAt: Date;
  chip: WhatWorkedChip;
  suggestedCause: CryCause | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  babyId: string;
  birthDate: string | null | undefined;
  /** The Now events (3 days and the running timers) and the baby's types. */
  events: readonly BabyEvent[];
  types: readonly EventType[];
  /** The cached predictions response; `null`/`undefined` offline without a cache. */
  predictions: PredictionsDto | null | undefined;
  shortcuts: Partial<Record<CryCause, CryShortcut>>;
  /** "What worked?" was answered: log the spell (the caller closes this sheet). */
  onAnswer: (answer: CryAnswerChoice) => void;
}

/** Three dots, filled by level: the level reads without colour (the label says it in words). */
const DOTS: Record<CryLevel, number> = { likely: 3, possible: 2, unlikely: 1 };

function LevelTag({ level }: { level: CryLevel }) {
  return (
    <Box
      component="span"
      data-level={level}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        flexShrink: 0,
        px: 1.25,
        py: 0.25,
        borderRadius: `${RADIUS.pill}px`,
        fontSize: '0.8125rem',
        fontWeight: level === 'likely' ? 700 : 500,
        color: level === 'likely' ? palette(theme).text.primary : palette(theme).text.secondary,
        boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
        '@media (forced-colors: active)': { border: '1px solid CanvasText' },
      })}
    >
      <Box component="span" aria-hidden sx={{ display: 'inline-flex', gap: '3px' }}>
        {[1, 2, 3].map((dot) => (
          <Box
            key={dot}
            component="span"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              border: '1px solid currentColor',
              backgroundColor: dot <= DOTS[level] ? 'currentColor' : 'transparent',
            }}
          />
        ))}
      </Box>
      {levelLabel(level)}
    </Box>
  );
}

function CauseCard({
  rank,
  history,
  shortcut,
}: {
  rank: CryCauseRank;
  history: CryOutcomeHistory | null;
  shortcut: CryShortcut | undefined;
}) {
  const { t } = useTranslation();
  const stat = history?.byCause[rank.cause];
  return (
    <Box
      component="li"
      data-testid={`cry-cause-${rank.cause}`}
      sx={(theme) => ({
        display: 'grid',
        gap: 0.75,
        p: 1.75,
        borderRadius: `${RADIUS.tile}px`,
        backgroundColor: palette(theme).surfaceRaised,
        minWidth: 0,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography
          component="h4"
          sx={{ flexGrow: 1, fontWeight: 600, fontSize: '1rem', overflowWrap: 'anywhere' }}
        >
          {causeName(rank.cause)}
        </Typography>
        <LevelTag level={rank.level} />
      </Box>
      {factSentences(rank.facts).map((sentence) => (
        <Typography key={sentence} variant="body2">
          {sentence}
        </Typography>
      ))}
      <Typography variant="body2" color="text.secondary">
        {tryText(rank.cause)}
      </Typography>
      {stat && stat.helped > 0 && (
        <Typography variant="caption" color="text.secondary" component="p">
          {t('cryReasons.suggests.helped', { helped: stat.helped, total: stat.total })}
        </Typography>
      )}
      {shortcut && (
        <Button
          variant="outlined"
          color="inherit"
          onClick={shortcut.run}
          sx={{ justifySelf: 'start', minHeight: 44, borderRadius: `${RADIUS.pill}px`, mt: 0.5 }}
        >
          {shortcut.label}
        </Button>
      )}
    </Box>
  );
}

/** Always first, never folded: when to call someone instead of reading the list. */
function RedFlagBanner() {
  const { t } = useTranslation();
  return (
    <Alert
      severity="warning"
      role="region"
      aria-label={t('cryReasons.redFlags.label')}
      icon={<Icon name="warning" size={24} />}
      sx={{ borderRadius: `${RADIUS.tile}px`, '& .MuiAlert-message': { minWidth: 0 } }}
    >
      <Typography component="p" sx={{ fontWeight: 600, color: 'inherit', mb: 0.5 }}>
        {t('cryReasons.redFlags.title')}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.25 }}>
        {CRY_RED_FLAGS.map((flag) => (
          <Typography key={flag} component="li" variant="body2" sx={{ color: 'inherit' }}>
            {redFlagText(flag)}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}

/**
 * "What worked?": one optional choice as a radio group. A choice logs the spell, so the arrow keys
 * only move the focus (a stray arrow never writes); Space, Enter or a tap chooses.
 */
function WhatWorked({
  chips,
  chosen,
  onChoose,
}: {
  chips: readonly WhatWorkedChip[];
  chosen: WhatWorkedChip | null;
  onChoose: (chip: WhatWorkedChip) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const refs = useRef(new Map<WhatWorkedChip, HTMLButtonElement>());
  const [focusable, setFocusable] = useState<WhatWorkedChip>(chips[0] as WhatWorkedChip);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const current = chips.findIndex((chip) => refs.current.get(chip) === event.target);
    if (current < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let index = -1;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = chips.length - 1;
    else if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') || event.key === 'ArrowDown') {
      index = (current + 1) % chips.length;
    } else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') || event.key === 'ArrowUp') {
      index = (current - 1 + chips.length) % chips.length;
    }
    const target = chips[index];
    if (target === undefined) return;
    event.preventDefault();
    setFocusable(target);
    refs.current.get(target)?.focus();
  };

  return (
    <Box component="section" aria-labelledby={titleId} sx={{ display: 'grid', gap: 1 }}>
      <Typography id={titleId} variant="h6" component="h3">
        {t('cryReasons.worked.title')}
      </Typography>
      <Typography id={hintId} variant="body2" color="text.secondary">
        {t('cryReasons.worked.hint')}
      </Typography>
      <Box
        role="radiogroup"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {chips.map((chip) => {
          const selected = chip === chosen;
          return (
            <Box
              key={chip}
              component="button"
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={chosen !== null}
              tabIndex={chip === (chosen ?? focusable) ? 0 : -1}
              ref={(element: HTMLButtonElement | null) => {
                if (element) refs.current.set(chip, element);
                else refs.current.delete(chip);
              }}
              onClick={() => onChoose(chip)}
              sx={(theme) => ({
                ...optionBase(theme),
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
                px: 1.75,
                borderRadius: `${RADIUS.pill}px`,
                backgroundColor: palette(theme).surfaceRaised,
                fontSize: '0.875rem',
                textAlign: 'center',
                ...(selected && {
                  color: palette(theme).text.primary,
                  fontWeight: 600,
                  boxShadow: `inset 0 0 0 1.5px ${palette(theme).primary.main}`,
                }),
              })}
            >
              {whatWorkedLabel(chip)}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** Answered fussy spells of the last two weeks, for the "Helped 3 of your last 5 times" hint. */
function useOutcomeHistory(
  babyId: string,
  fallback: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): CryOutcomeHistory | null {
  const [since] = useState(() =>
    new Date(Math.floor((now.getTime() - HISTORY_DAYS * DAY_MS) / HOUR_MS) * HOUR_MS).toISOString(),
  );
  const events = useEventsStartedSince(babyId, since);
  const history = cryOutcomeHistory(events ?? fallback, types, now);
  return history.spells >= MIN_ANSWERED_SPELLS ? history : null;
}

/**
 * "Why is she crying?" (docs/design/27-cry-reasons.md section 9): the red flags first and always,
 * then the everyday causes ranked from the log when the sheet opened (level, the facts behind it,
 * one safe thing to try, what helped before, a shortcut to the matching tray), "What worked?"
 * (one choice logs the spell) and the disclaimer. Offline: it reads only the local log and the
 * cached predictions.
 */
export function CryReasonsSheet({
  open,
  onClose,
  babyId,
  birthDate,
  events,
  types,
  predictions,
  shortcuts,
  onAnswer,
}: Props) {
  const { t } = useTranslation();
  const suggestsId = useId();
  // Ranked once, when the sheet opens: the list does not reorder under the parent's thumb.
  const [opened] = useState(() => {
    const now = new Date();
    return {
      now,
      result: rankCryReasons({ events, types, now, birthDate, predictions: predictions ?? null }),
    };
  });
  const history = useOutcomeHistory(babyId, events, types, opened.now);
  const chips = whatWorkedChips(types);
  const [chosen, setChosen] = useState<WhatWorkedChip | null>(null);
  const choose = (chip: WhatWorkedChip) => {
    if (chosen !== null) return;
    setChosen(chip);
    onAnswer({
      openedAt: opened.now,
      chip,
      suggestedCause: opened.result.causes[0]?.cause ?? null,
    });
  };

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      fullHeight
      title={t('cryReasons.title')}
      leading={<CategoryIcon name="mood-cry" category="care" size={24} />}
    >
      <RedFlagBanner />
      <Box component="section" aria-labelledby={suggestsId} sx={{ display: 'grid', gap: 1 }}>
        <Typography id={suggestsId} variant="h6" component="h3">
          {t('cryReasons.suggests.title')}
        </Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.25 }}>
          {opened.result.causes.map((rank) => (
            <CauseCard
              key={rank.cause}
              rank={rank}
              history={history}
              shortcut={shortcuts[rank.cause]}
            />
          ))}
        </Box>
      </Box>
      {chips.length > 0 && <WhatWorked chips={chips} chosen={chosen} onChoose={choose} />}
      <Typography variant="caption" color="text.secondary" component="p">
        {t('cryReasons.footer')}
      </Typography>
    </SheetFrame>
  );
}

/** The quiet entry on Now, the night view and the More sheet: icon and label, 44 px high. */
export function CryReasonsButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="text"
      onClick={onClick}
      startIcon={<Icon name="mood-cry" size={20} />}
      data-testid="cry-reasons-entry"
      sx={{ alignSelf: 'flex-start', minHeight: 44, px: 1.5, borderRadius: `${RADIUS.pill}px` }}
    >
      {t('cryReasons.entry')}
    </Button>
  );
}
