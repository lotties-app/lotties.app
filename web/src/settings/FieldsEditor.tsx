import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardContent,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { EventFieldKind } from '../db/models';
import { FIELD_KINDS, newFieldDraft, type FieldDraft } from './eventTypeModel';
import { Icon } from '../ui/Icon';

interface FieldCardProps {
  field: FieldDraft;
  position: number;
  onChange: (field: FieldDraft) => void;
  onRemove: () => void;
}

function FieldCard({ field, position, onChange, onRemove }: FieldCardProps) {
  const { t } = useTranslation();
  const set = (changes: Partial<FieldDraft>) => onChange({ ...field, ...changes });
  const prefix = t('settings.eventTypes.fieldN', { position });
  return (
    <Card variant="outlined" component="li" sx={{ listStyle: 'none' }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              {prefix}
            </Typography>
            <IconButton
              aria-label={t('settings.eventTypes.removeField', { field: prefix })}
              onClick={onRemove}
            >
              <Icon name="delete" />
            </IconButton>
          </Stack>
          <TextField
            label={t('settings.eventTypes.fieldLabel', { field: prefix })}
            value={field.label}
            onChange={(e) => set({ label: e.target.value })}
            autoComplete="off"
          />
          <TextField
            select
            label={t('settings.eventTypes.fieldType', { field: prefix })}
            value={field.kind}
            onChange={(e) => set({ kind: e.target.value as EventFieldKind })}
          >
            {FIELD_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {t(`settings.eventTypes.kinds.${kind}`)}
              </MenuItem>
            ))}
          </TextField>
          {field.kind === 'select' && (
            <TextField
              label={t('settings.eventTypes.fieldOptions', { field: prefix })}
              helperText={t('settings.eventTypes.optionsHelp')}
              value={field.options}
              onChange={(e) => set({ options: e.target.value })}
              multiline
              minRows={3}
            />
          )}
          {field.kind === 'number' && (
            <Stack direction="row" spacing={1}>
              <TextField
                label={t('settings.eventTypes.fieldMin', { field: prefix })}
                type="number"
                value={field.min}
                onChange={(e) => set({ min: e.target.value })}
              />
              <TextField
                label={t('settings.eventTypes.fieldMax', { field: prefix })}
                type="number"
                value={field.max}
                onChange={(e) => set({ max: e.target.value })}
              />
              <TextField
                label={t('settings.eventTypes.fieldUnit', { field: prefix })}
                value={field.unit}
                onChange={(e) => set({ unit: e.target.value })}
              />
            </Stack>
          )}
          {field.kind !== 'bool' && (
            <FormControlLabel
              label={t('common.required')}
              control={
                <Switch
                  checked={field.isRequired}
                  onChange={(_, on) => set({ isRequired: on })}
                  slotProps={{
                    input: {
                      'aria-label': t('settings.eventTypes.fieldRequired', { field: prefix }),
                    },
                  }}
                />
              }
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

interface Props {
  fields: FieldDraft[];
  onChange: (fields: FieldDraft[]) => void;
}

/** Ordered list of field definitions (text / number / choice / yes-no). */
export function FieldsEditor({ fields, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        {t('settings.eventTypes.fields')}
      </Typography>
      {fields.length === 0 && (
        <Typography color="text.secondary">{t('settings.eventTypes.noFields')}</Typography>
      )}
      <Stack
        component="ul"
        spacing={1}
        sx={{ p: 0, m: 0 }}
        aria-label={t('settings.eventTypes.fieldDefinitions')}
      >
        {fields.map((field, i) => (
          <FieldCard
            key={field.uid}
            field={field}
            position={i + 1}
            onChange={(next) => onChange(fields.map((f) => (f.uid === field.uid ? next : f)))}
            onRemove={() => onChange(fields.filter((f) => f.uid !== field.uid))}
          />
        ))}
      </Stack>
      <Button
        startIcon={<Icon name="add" />}
        onClick={() => onChange([...fields, newFieldDraft()])}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('settings.eventTypes.addField')}
      </Button>
    </Stack>
  );
}
