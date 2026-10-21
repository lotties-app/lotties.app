import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Collapse, Typography, useMediaQuery } from '@mui/material';
import type { EventFieldDefinition, EventType } from '../db/models';
import { useEventTypeText } from '../i18n/eventTypeText';
import { RADIUS } from '../theme/tokens';
import { Field, NumberStepper, OptionTiles, ChipGroup, SegmentedControl } from '../ui/form';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { getOwn } from '../util/ownProperty';
import { FieldControl } from './FieldControl';
import { hasDetailValue, sleepDetailFields, type DetailValues } from './sleepDetailModel';
import { optionIcon } from './optionIcons';

/*
 * "Sleep details" (docs/design/SYNTHESIS.md section 7): how a nap or night went, beyond its times.
 * A collapsed section, every field optional, rendered from the built-in sleep type's definitions
 * (the API declares them with `visibleWhen` kind in nap/night). Used by the event sheet and the
 * timer sheet; the caller owns the values and says how a change is saved.
 */

const QUICK_MINUTES = [5, 10, 15, 20] as const;

interface ControlProps {
  type: EventType;
  field: EventFieldDefinition;
  value: string | boolean | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}

function SelectDetail({ type, field, value, disabled, onChange }: ControlProps) {
  const names = useEventTypeText();
  const { t } = useTranslation();
  const current = typeof value === 'string' && value !== '' ? value : null;
  const options = field.options.map((option) => ({
    value: option,
    label: names.optionLabel(type, field, option),
    icon: optionIcon(type, field, option),
  }));
  if (field.key === 'how_slept') {
    return (
      <OptionTiles
        value={current}
        options={options}
        disabled={disabled}
        clearable
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }
  if (field.key === 'mood_on_wake') {
    return (
      <OptionTiles
        value={current}
        options={options}
        disabled={disabled}
        clearable
        aria-label={t('events.sleepDetails.moodAria')}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }
  if (field.key === 'how_woke') {
    return (
      <SegmentedControl
        value={current}
        options={options}
        disabled={disabled}
        clearable
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }
  return (
    <ChipGroup
      value={current}
      options={options}
      disabled={disabled}
      clearable
      onChange={(next) => onChange(next ?? '')}
    />
  );
}

function DetailControl(props: ControlProps) {
  const { field, value, disabled, onChange } = props;
  const { t } = useTranslation();
  const unit = t('ui.duration.unit');
  if (field.kind === 'select') return <SelectDetail {...props} />;
  if (field.kind === 'number') {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : null;
    return (
      <NumberStepper
        value={n !== null && Number.isFinite(n) ? n : null}
        onChange={(next) => onChange(next === null ? '' : String(next))}
        step={1}
        decimals={0}
        {...(field.min !== null ? { min: field.min } : { min: 0 })}
        {...(field.max !== null ? { max: field.max } : {})}
        unit={unit}
        quickValues={QUICK_MINUTES.filter((q) => field.max === null || q <= field.max)}
        start={10}
        disabled={disabled}
      />
    );
  }
  return (
    <FieldControl
      type={props.type}
      field={field}
      value={value}
      onChange={(next) => onChange(String(next))}
    />
  );
}

interface Props {
  type: EventType | undefined;
  values: DetailValues;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  /** Starts expanded (tests, screenshots); collapsed by default. */
  defaultOpen?: boolean;
}

/**
 * The collapsed "Sleep details" section: a header button (title, "All optional" or how many details
 * are filled) that opens the fields: how falling asleep went (chips and minutes), where and how
 * (picture tiles), how waking happened and the mood on waking. Renders nothing for other types and
 * for sleep events without a nap or night kind.
 */
export function SleepDetails({
  type,
  values,
  onChange,
  disabled = false,
  defaultOpen = false,
}: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const fields = sleepDetailFields(type, values);
  if (!type || fields.length === 0) return null;
  const filled = fields.filter((f) => hasDetailValue(getOwn(values, f.key))).length;
  const hint =
    filled > 0
      ? t('events.sleepDetails.filled', { count: filled })
      : t('events.sleepDetails.optional');

  return (
    <Box data-field-key="sleep-details" component="section" aria-labelledby={`${id}-title`}>
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        sx={(theme) => ({
          width: '100%',
          minHeight: 56,
          px: 2,
          py: 1,
          gap: 1.5,
          justifyContent: 'space-between',
          textAlign: 'start',
          borderRadius: `${RADIUS.input}px`,
          backgroundColor: palette(theme).surfaceRaised,
          '&:focus-visible': {
            outline: `2px solid ${palette(theme).primary.main}`,
            outlineOffset: 2,
          },
        })}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id={`${id}-title`}
            component="span"
            sx={{ fontWeight: 600, display: 'block' }}
          >
            {t('events.sleepDetails.title')}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="span">
            {hint}
          </Typography>
        </Box>
        <Icon name={open ? 'collapse' : 'expand'} size={24} />
      </ButtonBase>
      <Collapse in={open} timeout={reducedMotion ? 0 : 'auto'} unmountOnExit>
        <Box
          id={`${id}-panel`}
          role="group"
          aria-labelledby={`${id}-title`}
          sx={{ display: 'grid', gap: 2.5, pt: 2 }}
        >
          {fields.map((field) => (
            <Box key={field.key} data-field-key={field.key}>
              <Field label={names.fieldLabel(type, field)} group={field.kind === 'select'}>
                <DetailControl
                  type={type}
                  field={field}
                  value={getOwn(values, field.key)}
                  disabled={disabled}
                  onChange={(next) => onChange(field.key, next)}
                />
              </Field>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
