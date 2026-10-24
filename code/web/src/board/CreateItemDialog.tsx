import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import { Icon } from '../ui/Icon';
import { createItem, type BoardItem, type BoardTopic } from './boardApi';
import { boardErrorOverrides } from './boardErrors';
import { ItemForm } from './ItemForm';
import { createBody, validateForm, type FormErrors, type ItemFormState } from './itemFormModel';

interface Props {
  initial: ItemFormState;
  topics: readonly BoardTopic[];
  onClose: () => void;
  onCreated: (item: BoardItem) => void;
}

/** The full form for a new item: a dialog, full screen on phones. */
export function CreateItemDialog({ initial, topics, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const api = useApiClient();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  // One id for the whole dialog: a retry of the same create is idempotent.
  const [id] = useState(() => crypto.randomUUID());
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [serverField, setServerField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const found = validateForm(value);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      onCreated(await createItem(api, createBody(value, id)));
    } catch (error) {
      setServerField(error instanceof ApiError ? (error.problem?.field ?? null) : null);
      setFailure(describeApiError(error, boardErrorOverrides()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      fullScreen={phone}
      fullWidth
      maxWidth="md"
      onClose={onClose}
      aria-labelledby={titleId}
      scroll="paper"
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
      >
        <DialogTitle
          id={titleId}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
        >
          {t('board.create.title')}
          <IconButton
            aria-label={t('board.drawer.close')}
            onClick={onClose}
            sx={{ width: 44, height: 44 }}
          >
            <Icon name="close" size={20} />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {failure && (
            <Alert severity="error" role="alert" sx={{ mb: 2 }}>
              {failure}
            </Alert>
          )}
          <ItemForm
            value={value}
            onChange={setValue}
            topics={topics}
            errors={errors}
            serverField={serverField}
            autoFocusTitle={!value.title}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} sx={{ minHeight: 44 }}>
            {t('board.drawer.cancel')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 44 }}>
            {t('board.create.save')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
