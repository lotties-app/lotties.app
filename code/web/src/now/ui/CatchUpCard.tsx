import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Button, Card, Typography } from '@mui/material';
import type { EventType } from '../../db/models';
import { RADIUS } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { palette } from '../../ui/form/styles';
import { Icon } from '../../ui/Icon';
import type { CatchUp } from '../catchUp';
import { catchUpLines, catchUpShareText, catchUpSummary } from '../catchUpText';
import { catchUpName } from '../nowText';
import { shareText, type ShareResult } from '../shareText';

interface Props {
  catchUp: CatchUp;
  babyName: string;
  types: readonly EventType[];
  /** "Got it": the card is done and the next catch-up starts now. */
  onDone: () => void;
}

/**
 * "Since you last looked": what the other caregivers logged, one block per person, with a button
 * that shares it as plain text (Web Share, else the clipboard) for someone who has no app.
 */
export function CatchUpCard({ catchUp, babyName, types, onDone }: Props) {
  const { t } = useTranslation();
  const [result, setResult] = useState<ShareResult | null>(null);

  const share = async () => {
    setResult(await shareText(catchUpShareText(catchUp, babyName, types)));
  };

  return (
    <Card
      component="section"
      aria-label={t('now.catchUp.title')}
      sx={(theme) => ({ p: 2.5, backgroundColor: palette(theme).category.sleep.bg })}
    >
      <Typography
        variant="h5"
        component="h2"
        sx={{ color: (theme) => palette(theme).category.sleep.fg }}
      >
        {t('now.catchUp.title')}
      </Typography>
      {catchUp.groups.map((group) => (
        <Box key={group.userId} sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Avatar
              aria-hidden
              sx={{
                width: 32,
                height: 32,
                fontSize: '0.8125rem',
                bgcolor: 'background.paper',
                color: 'text.primary',
              }}
            >
              {catchUpName(group).charAt(0).toUpperCase()}
            </Avatar>
            <Typography variant="body2" sx={{ color: 'text.primary' }}>
              {catchUpSummary(group, catchUp.since)}
            </Typography>
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {catchUpLines(group, types).map((line, index) => (
              <Box
                component="li"
                key={`${line.category}-${index}`}
                sx={(theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  py: 1,
                  borderTop: `1px solid ${palette(theme).hairline}`,
                })}
              >
                <CategoryIcon name={line.icon} category={line.category} size={20} />
                <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.primary' }}>
                  {line.text}
                </Typography>
                {line.detail && (
                  <Typography
                    variant="caption"
                    sx={{ textAlign: 'right', color: 'text.secondary' }}
                  >
                    {line.detail}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<Icon name="share" size={20} />}
          onClick={() => void share()}
          sx={{ flex: 1, minHeight: 48, borderRadius: `${RADIUS.button}px` }}
        >
          {t('now.catchUp.share')}
        </Button>
        <Button color="primary" onClick={onDone} sx={{ flex: 1, minHeight: 48 }}>
          {t('now.catchUp.gotIt')}
        </Button>
      </Box>
      <Typography
        role="status"
        variant="caption"
        sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}
      >
        {result === 'copied'
          ? t('now.catchUp.copied')
          : result === 'failed'
            ? t('now.catchUp.shareFailed')
            : ''}
      </Typography>
    </Card>
  );
}
