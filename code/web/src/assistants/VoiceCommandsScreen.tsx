import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { nativePlatform } from '../platform/nativeApp';
import {
  commandsOf,
  defaultAssistant,
  VOICE_ASSISTANTS,
  VOICE_TOPICS,
  type VoiceAssistant,
  type VoiceCommand,
  type VoiceTopic,
} from './voiceCommands';

const SAFETY = ['facts', 'cry', 'medication', 'names', 'undo', 'internet', 'baby'] as const;

/**
 * Settings > Voice assistants > Voice commands (docs/VOICE-COMMANDS.md): what to say to Siri, Alexa
 * and Android, what it does and what the answer sounds like, grouped by topic. Static content any
 * member can read; the tab of this device's assistant opens first.
 */
export function VoiceCommandsScreen() {
  const { t } = useTranslation();
  const ids = useId();
  const [assistant, setAssistant] = useState<VoiceAssistant>(() =>
    defaultAssistant(nativePlatform()),
  );

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">{t('voiceCommands.intro')}</Typography>
      <Tabs
        value={assistant}
        onChange={(_, next: VoiceAssistant) => setAssistant(next)}
        aria-label={t('voiceCommands.tabsLabel')}
        variant="fullWidth"
      >
        {VOICE_ASSISTANTS.map((id) => (
          <Tab
            key={id}
            value={id}
            id={`${ids}-${id}`}
            aria-controls={`${ids}-${id}-panel`}
            label={t(`voiceCommands.tabs.${id}`)}
            sx={{ minHeight: 48 }}
          />
        ))}
      </Tabs>
      <Stack
        spacing={2}
        role="tabpanel"
        id={`${ids}-${assistant}-panel`}
        aria-labelledby={`${ids}-${assistant}`}
      >
        <Alert severity="info">{t(`voiceCommands.status.${assistant}`)}</Alert>
        <Typography>{t(`voiceCommands.start.${assistant}`)}</Typography>
        {VOICE_TOPICS.map((topic) => (
          <TopicSection key={topic} assistant={assistant} topic={topic} />
        ))}
      </Stack>
      <Stack spacing={1} component="section" aria-labelledby={`${ids}-safety`}>
        <Typography variant="h6" component="h2" id={`${ids}-safety`}>
          {t('voiceCommands.safety.title')}
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {SAFETY.map((key) => (
            <Typography key={key} component="li" variant="body2" sx={{ mb: 0.5 }}>
              {t(`voiceCommands.safety.${key}`)}
            </Typography>
          ))}
        </Box>
      </Stack>
    </Stack>
  );
}

function TopicSection({ assistant, topic }: { assistant: VoiceAssistant; topic: VoiceTopic }) {
  const { t } = useTranslation();
  const headingId = useId();
  const commands = commandsOf(assistant, topic);
  if (commands.length === 0) return null;
  return (
    <Stack spacing={1} component="section" aria-labelledby={headingId}>
      <Typography variant="h6" component="h2" id={headingId}>
        {t(`voiceCommands.topics.${topic}`)}
      </Typography>
      {commands.map((command) => (
        <CommandCard
          key={command.say}
          command={command}
          phraseLabel={t(
            assistant === 'android' ? 'voiceCommands.labels.shortcut' : 'voiceCommands.labels.say',
          )}
        />
      ))}
    </Stack>
  );
}

function CommandCard({ command, phraseLabel }: { command: VoiceCommand; phraseLabel: string }) {
  const { t } = useTranslation();
  return (
    <Paper variant="outlined" component="article" sx={{ p: 1.5 }}>
      <Typography variant="caption" color="text.secondary" component="p">
        {phraseLabel}
      </Typography>
      <Typography sx={{ fontWeight: 600 }}>{t(`voiceCommands.say.${command.say}`)}</Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {t('voiceCommands.labels.does')}
      </Typography>
      <Typography variant="body2">{t(`voiceCommands.actions.${command.action}.does`)}</Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {t('voiceCommands.labels.answer')}
      </Typography>
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {t(`voiceCommands.actions.${command.action}.answer`)}
      </Typography>
    </Paper>
  );
}
