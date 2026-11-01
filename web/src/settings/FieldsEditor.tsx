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
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { EventFieldKind } from '../db/models';
import { FIELD_KINDS, newFieldDraft, type FieldDraft } from './eventTypeModel';

interface FieldCardProps {
  field: FieldDraft;
  position: number;
  onChange: (field: FieldDraft) => void;
  onRemove: () => void;
}

function FieldCard({ field, position, onChange, onRemove }: FieldCardProps) {
  const set = (changes: Partial<FieldDraft>) => onChange({ ...field, ...changes });
  const prefix = `Field ${position}`;
  return (
    <Card variant="outlined" component="li" sx={{ listStyle: 'none' }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              {prefix}
            </Typography>
            <IconButton aria-label={`Remove ${prefix}`} onClick={onRemove}>
              <DeleteIcon />
            </IconButton>
          </Stack>
          <TextField
            label={`${prefix} label`}
            value={field.label}
            onChange={(e) => set({ label: e.target.value })}
            autoComplete="off"
          />
          <TextField
            select
            label={`${prefix} type`}
            value={field.kind}
            onChange={(e) => set({ kind: e.target.value as EventFieldKind })}
          >
            {FIELD_KINDS.map((k) => (
              <MenuItem key={k.kind} value={k.kind}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          {field.kind === 'select' && (
            <TextField
              label={`${prefix} options`}
              helperText="One option per line."
              value={field.options}
              onChange={(e) => set({ options: e.target.value })}
              multiline
              minRows={3}
            />
          )}
          {field.kind === 'number' && (
            <Stack direction="row" spacing={1}>
              <TextField
                label={`${prefix} min`}
                type="number"
                value={field.min}
                onChange={(e) => set({ min: e.target.value })}
              />
              <TextField
                label={`${prefix} max`}
                type="number"
                value={field.max}
                onChange={(e) => set({ max: e.target.value })}
              />
              <TextField
                label={`${prefix} unit`}
                value={field.unit}
                onChange={(e) => set({ unit: e.target.value })}
              />
            </Stack>
          )}
          {field.kind !== 'bool' && (
            <FormControlLabel
              label="Required"
              control={
                <Switch
                  checked={field.isRequired}
                  onChange={(_, on) => set({ isRequired: on })}
                  slotProps={{ input: { 'aria-label': `${prefix} required` } }}
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
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        Fields
      </Typography>
      {fields.length === 0 && (
        <Typography color="text.secondary">
          No extra fields. Events only record time and notes.
        </Typography>
      )}
      <Stack component="ul" spacing={1} sx={{ p: 0, m: 0 }} aria-label="Field definitions">
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
        startIcon={<AddIcon />}
        onClick={() => onChange([...fields, newFieldDraft()])}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        Add field
      </Button>
    </Stack>
  );
}
