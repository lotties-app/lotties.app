import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useCareProviderCommands } from '../db/hooks';
import type { CareProvider } from '../db/models';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { announceUndo } from '../ui/undoNotice';
import { ProviderContact } from './ProviderContact';
import { registrationLine } from './providerModel';
import { useSpecialtyLabel } from './useSpecialtyLabel';

interface Props {
  provider: CareProvider;
  /** Owner or Parent: edit, favorite and delete. Others only read and use the links. */
  writable: boolean;
  onClose: () => void;
  onEdit: (provider: CareProvider) => void;
}

/**
 * One care provider: specialty, registration, clinic, the contact links (call, WhatsApp, e-mail,
 * website, address with "Open in maps") and notes. Owners and Parents also Edit, mark as favorite
 * and Delete (with Undo; appointments keep the text they copied). Caregivers and Viewers read.
 */
export function ProviderDetailSheet({ provider, writable, onClose, onEdit }: Props) {
  const { t } = useTranslation();
  const commands = useCareProviderCommands();
  const { labelOf } = useSpecialtyLabel();
  const specialty = labelOf(provider.specialty);
  const registration = registrationLine(provider);

  const remove = async () => {
    await commands.remove(provider.id);
    onClose();
    announceUndo(t('providers.detail.deletedNotice', { name: provider.name }), async () => {
      await commands.restore(provider.id);
    });
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={provider.name}
      {...(specialty ? { subtitle: specialty } : {})}
      leading={<CategoryIcon name="stethoscope" category="health" size={24} />}
    >
      <Stack spacing={1.5}>
        {registration && (
          <Box>
            <Typography variant="caption" color="text.secondary" component="p">
              {t('providers.detail.registration')}
            </Typography>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{registration}</Typography>
          </Box>
        )}
        {provider.clinicName && (
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <Box sx={{ color: 'text.secondary', pt: 0.25, flex: 'none' }}>
              <Icon name="hospital" size={20} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" component="p">
                {t('providers.detail.clinic')}
              </Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{provider.clinicName}</Typography>
            </Box>
          </Box>
        )}
        <ProviderContact provider={provider} />
        {provider.notes && (
          <Box>
            <Typography variant="caption" color="text.secondary" component="p">
              {t('providers.detail.notes')}
            </Typography>
            <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
              {provider.notes}
            </Typography>
          </Box>
        )}
      </Stack>
      <Stack spacing={1}>
        {writable && (
          <Button
            variant="outlined"
            startIcon={<Icon name="edit" size={20} />}
            onClick={() => onEdit(provider)}
            sx={{ minHeight: 48 }}
          >
            {t('providers.detail.edit')}
          </Button>
        )}
        {writable && (
          <Button
            aria-pressed={provider.favorite}
            startIcon={<Icon name={provider.favorite ? 'star-filled' : 'star'} size={20} />}
            onClick={() => void commands.setFavorite(provider.id, !provider.favorite)}
            sx={{ minHeight: 48 }}
          >
            {provider.favorite ? t('providers.detail.unfavorite') : t('providers.detail.favorite')}
          </Button>
        )}
        {writable && (
          <Button
            color="error"
            startIcon={<Icon name="delete" size={20} />}
            onClick={() => void remove()}
            sx={{ minHeight: 48 }}
          >
            {t('providers.detail.delete')}
          </Button>
        )}
        {!writable && (
          <Typography variant="body2" color="text.secondary">
            {t('providers.viewOnly')}
          </Typography>
        )}
      </Stack>
    </SheetFrame>
  );
}
