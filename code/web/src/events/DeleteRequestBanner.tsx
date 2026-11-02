import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import type { BabyEvent } from '../db/models';
import { deleteRequestedVia } from './assistantOrigin';

/**
 * "Alexa asked to delete this entry" with Delete and Keep (docs/design/32-assistants.md "Assistants
 * never delete"): an assistant can only ask, the person decides here. Without the two handlers (a
 * Viewer, or someone else's entry the user may not change) it only says what was asked.
 */
export function DeleteRequestBanner({
  event,
  onDelete,
  onKeep,
}: {
  event: Pick<BabyEvent, 'payload'>;
  onDelete?: () => void;
  onKeep?: () => void;
}) {
  const { t } = useTranslation();
  const asked = deleteRequestedVia(event);
  if (!asked) return null;
  const text =
    asked === 'alexa'
      ? t('assistants.deleteRequest.alexa')
      : asked === 'siri'
        ? t('assistants.deleteRequest.siri')
        : asked === 'android'
          ? t('assistants.deleteRequest.android')
          : t('assistants.deleteRequest.assistant');
  return (
    <Box
      role="group"
      aria-label={text}
      data-testid="delete-request"
      sx={{ display: 'grid', gap: 1, flexBasis: '100%', px: 2, pb: 1.5 }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {text}
      </Typography>
      {onDelete && onKeep && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            color="error"
            onClick={onDelete}
            sx={{ minHeight: 44, flex: '1 1 120px', borderRadius: '999px' }}
          >
            {t('assistants.deleteRequest.delete')}
          </Button>
          <Button
            variant="outlined"
            onClick={onKeep}
            sx={{ minHeight: 44, flex: '1 1 120px', borderRadius: '999px' }}
          >
            {t('assistants.deleteRequest.keep')}
          </Button>
        </Box>
      )}
    </Box>
  );
}
