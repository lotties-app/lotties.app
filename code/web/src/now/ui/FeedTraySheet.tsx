import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import type { EventType } from '../../db/models';
import { BottleSuggestionCaption } from '../../events/BottleSuggestionCaption';
import { drunkChoices } from '../../events/bottleAmounts';
import { eventTypeText } from '../../i18n/eventTypeText';
import { formatNumber } from '../../i18n/format';
import { Illustration } from '../../ui/illustrations';
import { ChipGroup, NumberStepper, SegmentedControl } from '../../ui/form';
import { Icon } from '../../ui/Icon';
import { otherSide, type BreastSide } from '../nursing';
import { sideLabel } from '../nowText';
import type { FeedTray } from '../quickLog';
import { SheetFrame } from './SheetFrame';

type Method = 'breast' | 'bottle' | 'solid';
const METHODS: readonly Method[] = ['breast', 'bottle', 'solid'];
const OTHER = 'other';

interface Props {
  open: boolean;
  onClose: () => void;
  tray: FeedTray;
  type: EventType | undefined;
  /** "Last 2h ago · Bottle · 120 ml" under the title. */
  subtitle: string;
  disabled: boolean;
  /** `drunkMl`: what the baby drank when it is less than `amountMl`, else `null` (all of it). */
  onBottle: (amountMl: number, content: string | null, drunkMl: number | null) => void;
  onBreast: (side: BreastSide) => void;
  /** Solid food: the event sheet prefilled. */
  onSolid: () => void;
}

const methodIcon = { breast: 'heart', bottle: 'bottle', solid: 'utensils' } as const;

function initialMethod(tray: FeedTray): Method {
  return METHODS.find((m) => m === tray.lastMethod) ?? 'bottle';
}

function BottlePanel({
  tray,
  type,
  disabled,
  onBottle,
}: Pick<Props, 'tray' | 'type' | 'disabled' | 'onBottle'>) {
  const { t } = useTranslation();
  const { bottle } = tray;
  const field = type?.fields.find((f) => f.key === 'amount_ml');
  const [amount, setAmount] = useState<number | null>(bottle.amountMl);
  const [custom, setCustom] = useState(!bottle.amounts.includes(bottle.amountMl));
  const [content, setContent] = useState<string | null>(bottle.content);
  // Drunk less than prepared (ml); `null` = all of it, the default.
  const [drunk, setDrunk] = useState<number | null>(null);
  const chosen = amount ?? 0;
  const partly = drunk !== null && drunk < chosen ? drunk : null;
  const shares = drunkChoices(chosen);
  const contentLabel = (value: string) =>
    type ? eventTypeText.optionLabel(type, { key: 'bottle_feeding_type' }, value) : value;

  return (
    <>
      <Typography variant="overline" component="p" color="text.secondary">
        {t('now.feedTray.amount')}
      </Typography>
      <ChipGroup
        aria-label={t('now.feedTray.amount')}
        value={custom ? OTHER : String(amount ?? '')}
        onChange={(value) => {
          if (value === OTHER) {
            setCustom(true);
            return;
          }
          if (value !== null) {
            setCustom(false);
            setAmount(Number(value));
            setDrunk(null);
          }
        }}
        options={[
          ...bottle.amounts.map((ml) => ({
            value: String(ml),
            label: `${formatNumber(ml)} ml`,
          })),
          { value: OTHER, label: t('now.feedTray.otherAmount') },
        ]}
      />
      <BottleSuggestionCaption suggestions={bottle.suggestions} />
      {custom && (
        <NumberStepper
          aria-label={t('now.feedTray.amount')}
          value={amount}
          onChange={(next) => {
            setAmount(next);
            setDrunk(null);
          }}
          step={bottle.suggestions.step}
          min={field?.min ?? 0}
          max={field?.max ?? 500}
          start={bottle.amountMl}
          unit="ml"
        />
      )}
      {chosen > 0 && (
        <>
          <Typography variant="overline" component="p" color="text.secondary">
            {t('feedingAmounts.tray.drunk')}
          </Typography>
          <ChipGroup
            aria-label={t('feedingAmounts.tray.drunk')}
            value={String(partly ?? chosen)}
            onChange={(value) => {
              if (value !== null) setDrunk(Number(value) < chosen ? Number(value) : null);
            }}
            options={shares.map((choice) => ({
              value: String(choice.ml),
              label: `${formatNumber(choice.ml)} ml \u00b7 ${t(`feedingAmounts.share.${choice.share}`)}`,
            }))}
          />
        </>
      )}
      {bottle.contents.length > 0 && (
        <>
          <Typography variant="overline" component="p" color="text.secondary">
            {t('now.feedTray.content')}
          </Typography>
          <SegmentedControl
            aria-label={t('now.feedTray.content')}
            value={content}
            clearable
            onChange={setContent}
            options={bottle.contents.map((value) => ({ value, label: contentLabel(value) }))}
          />
        </>
      )}
      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={disabled || chosen <= 0}
        onClick={() => onBottle(chosen, content, partly)}
        sx={{ minHeight: 56 }}
      >
        {partly !== null
          ? content
            ? t('feedingAmounts.tray.logDrunkContent', {
                drunk: formatNumber(partly),
                prepared: formatNumber(chosen),
                content: contentLabel(content).toLocaleLowerCase(),
              })
            : t('feedingAmounts.tray.logDrunk', {
                drunk: formatNumber(partly),
                prepared: formatNumber(chosen),
              })
          : content
            ? t('now.feedTray.logContent', {
                amount: formatNumber(chosen),
                content: contentLabel(content).toLocaleLowerCase(),
              })
            : t('now.feedTray.log', { amount: formatNumber(chosen) })}
      </Button>
    </>
  );
}

function BreastPanel({ tray, disabled, onBreast }: Pick<Props, 'tray' | 'disabled' | 'onBreast'>) {
  const { t } = useTranslation();
  const { breast } = tray;
  const running = breast.runningId !== null;
  return (
    <>
      {breast.lastSide && (
        <Typography variant="body2" color="text.secondary">
          {t('now.feedTray.lastSide', { side: sideLabel(breast.lastSide) })}
        </Typography>
      )}
      {running && (
        <Typography variant="body2" color="text.secondary">
          {t('now.feedTray.alreadyRunning')}
        </Typography>
      )}
      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={disabled || running}
        startIcon={<Icon name="heart" size={24} />}
        onClick={() => onBreast(breast.side)}
        sx={{ minHeight: 56 }}
      >
        {t('now.feedTray.startOn', { side: sideLabel(breast.side) })}
      </Button>
      <Button
        color="inherit"
        fullWidth
        disabled={disabled || running}
        onClick={() => onBreast(otherSide(breast.side))}
        sx={{ minHeight: 48, color: 'text.secondary' }}
      >
        {t('now.feedTray.startOn', { side: sideLabel(otherSide(breast.side)) })}
      </Button>
    </>
  );
}

/**
 * The Feed tray: Breast (starts the live nursing timer on the suggested side), Bottle (amount
 * chips with the last amount selected, so one tap repeats the last feed) or Solid food (opens the
 * event sheet). The time can be corrected right after, with the toast's chips.
 */
export function FeedTraySheet(props: Props) {
  const { t } = useTranslation();
  const { open, onClose, tray, type, subtitle, disabled, onSolid } = props;
  const [method, setMethod] = useState<Method>(() => initialMethod(tray));
  const label = (m: Method) => (type ? eventTypeText.optionLabel(type, { key: 'method' }, m) : m);

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={t('now.feedTray.title')}
      subtitle={subtitle || undefined}
      leading={<Illustration name="bottle" size={48} />}
    >
      <SegmentedControl
        aria-label={t('now.feedTray.method')}
        value={method}
        onChange={(value) => value && setMethod(value)}
        options={METHODS.map((m) => ({ value: m, label: label(m), icon: methodIcon[m] }))}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {method === 'bottle' && (
          <BottlePanel tray={tray} type={type} disabled={disabled} onBottle={props.onBottle} />
        )}
        {method === 'breast' && (
          <BreastPanel tray={tray} disabled={disabled} onBreast={props.onBreast} />
        )}
        {method === 'solid' && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('now.feedTray.solidHint')}
            </Typography>
            <Button
              variant="contained"
              size="large"
              fullWidth
              disabled={disabled}
              onClick={onSolid}
              sx={{ minHeight: 56 }}
            >
              {t('now.feedTray.solidOpen')}
            </Button>
          </>
        )}
      </Box>
    </SheetFrame>
  );
}
