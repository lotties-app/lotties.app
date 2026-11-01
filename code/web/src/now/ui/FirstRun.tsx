import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { RADIUS, type CategoryName } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { Illustration } from '../../ui/illustrations';
import { palette } from '../../ui/form/styles';
import type { IconName } from '../../ui/icons';

interface Props {
  babyName: string;
  /** Viewers cannot log or import. */
  readOnly: boolean;
  /** Owners can invite. */
  canInvite: boolean;
  onFellAsleep: () => void;
  onFeed: () => void;
  disabled: boolean;
}

function OfferCard({
  icon,
  category,
  title,
  body,
  action,
  to,
}: {
  icon: IconName;
  category: CategoryName;
  title: string;
  body: string;
  action: string;
  to: string;
}) {
  return (
    <Card component="section" aria-label={title} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <CategoryIcon name={icon} category={category} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2">
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {body}
          </Typography>
        </Box>
        <Button component={Link} to={to} variant="outlined" color="inherit" sx={{ minHeight: 44 }}>
          {action}
        </Button>
      </Stack>
    </Card>
  );
}

/**
 * A baby with no events yet: one honest first step (the two most common actions), where the
 * predictions will come from, and the two things that decide whether a family sticks with the app,
 * importing the history and inviting the other parent (docs/design/01-ux-strategy.md section 5).
 */
export function FirstRun({ babyName, readOnly, canInvite, onFellAsleep, onFeed, disabled }: Props) {
  const { t } = useTranslation();
  const options = [
    {
      key: 'sleep',
      category: 'sleep',
      art: 'fell_asleep',
      label: t('now.sleepActions.fellAsleep'),
      run: onFellAsleep,
    },
    { key: 'feed', category: 'feeding', art: 'bottle', label: t('now.tiles.feed'), run: onFeed },
  ] as const;
  return (
    <>
      <Card
        component="section"
        aria-label={t('now.firstRun.title', { name: babyName })}
        sx={{ p: 2.5 }}
      >
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" component="h2">
              {t('now.firstRun.title', { name: babyName })}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {readOnly ? t('now.firstRun.viewer') : t('now.firstRun.body')}
            </Typography>
          </Box>
          <Illustration name="woke_up" size={96} glow />
        </Box>
        {!readOnly && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 2 }}>
            {options.map((option) => (
              <Box
                key={option.key}
                component="button"
                type="button"
                disabled={disabled}
                onClick={option.run}
                sx={(theme) => ({
                  appearance: 'none',
                  border: 0,
                  font: 'inherit',
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: 104,
                  borderRadius: `${RADIUS.tile}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.75,
                  backgroundColor: palette(theme).category[option.category].bg,
                  color: palette(theme).category[option.category].fg,
                  '&:focus-visible': {
                    outline: `2px solid ${palette(theme).primary.main}`,
                    outlineOffset: 2,
                  },
                  '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
                })}
              >
                <Illustration name={option.art} size={64} />
                {option.label}
              </Box>
            ))}
          </Box>
        )}
      </Card>
      <Card
        component="section"
        aria-label={t('now.learning.title', { name: babyName })}
        sx={{ p: 2 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CategoryIcon name="seedling" category="care" />
          <Box>
            <Typography variant="subtitle1" component="h2">
              {t('now.learning.title', { name: babyName })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('now.firstRun.learning')}
            </Typography>
          </Box>
        </Stack>
      </Card>
      {!readOnly && (
        <OfferCard
          icon="upload-file"
          category="feeding"
          title={t('now.firstRun.importTitle')}
          body={t('now.firstRun.importBody')}
          action={t('now.firstRun.importAction')}
          to="/settings#import"
        />
      )}
      {canInvite && (
        <OfferCard
          icon="heart"
          category="health"
          title={t('now.firstRun.inviteTitle', { name: babyName })}
          body={t('now.firstRun.inviteBody')}
          action={t('now.firstRun.inviteAction')}
          to="/settings#members"
        />
      )}
    </>
  );
}
