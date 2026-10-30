import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Stack,
  Typography,
} from '@mui/material';
import { Icon } from '../ui/Icon';
import { GuideSteps } from './GuideSteps';
import { GUIDES } from './guides';
import { InstallButton } from './InstallButton';
import type { InstallOs } from './installPlatform';
import { useInstallState } from './useInstallState';

const SECTION_ORDER: readonly InstallOs[] = ['ios', 'android', 'desktop'];

function Section({
  id,
  title,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Accordion
      expanded={expanded}
      onChange={onToggle}
      disableGutters
      slotProps={{ heading: { component: 'h2' } }}
    >
      <AccordionSummary
        id={`${id}-header`}
        aria-controls={`${id}-content`}
        expandIcon={<Icon name="expand" size={24} />}
        sx={{ minHeight: 56 }}
      >
        <Typography variant="h6" component="span">
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={`${id}-content`}>
        <Stack spacing={2}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function SubHeading({ children, level = 'h3' }: { children: ReactNode; level?: 'h3' | 'h4' }) {
  return (
    <Typography variant="subtitle1" component={level} sx={{ fontWeight: 700 }}>
      {children}
    </Typography>
  );
}

function Trouble({ title, body }: { title: string; body: string }) {
  return (
    <Box>
      <SubHeading>{title}</SubHeading>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{body}</Typography>
    </Box>
  );
}

/**
 * The install guide (public /install and Hub > Install the app; no h1 of its own, the route has it).
 * Every platform is shown; the one this browser runs on comes first and open. Inside the store app
 * nothing install-related is shown; in the installed app, only that it is installed and how to
 * update or remove it.
 */
export function InstallContent() {
  const { t } = useTranslation();
  const state = useInstallState();
  const detected = state.platform.os;
  const [open, setOpen] = useState<ReadonlySet<InstallOs>>(() => new Set([detected]));
  const toggle = (os: InstallOs) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(os)) next.delete(os);
      else next.add(os);
      return next;
    });
  const [otherOpen, setOtherOpen] = useState(false);

  if (state.native) return <Alert severity="info">{t('install.native')}</Alert>;

  const updateAndRemove = (
    <>
      <Trouble title={t('install.trouble.updateTitle')} body={t('install.trouble.update')} />
      <Trouble title={t('install.trouble.uninstallTitle')} body={t('install.trouble.uninstall')} />
    </>
  );

  if (state.installed) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">{t('install.installed')}</Alert>
        {updateAndRemove}
      </Stack>
    );
  }

  const sections: Record<InstallOs, ReactNode> = {
    ios: (
      <Section
        key="ios"
        id="install-ios"
        title={t('install.sections.ios')}
        expanded={open.has('ios')}
        onToggle={() => toggle('ios')}
      >
        <Typography color="text.secondary">{t('install.ios.requirement')}</Typography>
        <GuideSteps hint={GUIDES.iosSafari.hint} steps={GUIDES.iosSafari.steps} />
        <Typography>{t('install.ios.ipad')}</Typography>
        <Typography color="text.secondary">{t('install.ios.otherBrowsers')}</Typography>
        <Box>
          <SubHeading>{t('install.ios.whyTitle')}</SubHeading>
          <Typography>{t('install.ios.why')}</Typography>
        </Box>
      </Section>
    ),
    android: (
      <Section
        key="android"
        id="install-android"
        title={t('install.sections.android')}
        expanded={open.has('android')}
        onToggle={() => toggle('android')}
      >
        <GuideSteps hint={GUIDES.androidChrome.hint} steps={GUIDES.androidChrome.steps} />
        <Typography color="text.secondary">{t('install.android.notifications')}</Typography>
        <Accordion
          expanded={otherOpen}
          onChange={() => setOtherOpen((value) => !value)}
          disableGutters
          variant="outlined"
          slotProps={{ heading: { component: 'h3' } }}
        >
          <AccordionSummary
            id="install-android-other-header"
            aria-controls="install-android-other-content"
            expandIcon={<Icon name="expand" size={24} />}
            sx={{ minHeight: 48 }}
          >
            <Typography component="span" sx={{ fontWeight: 600 }}>
              {t('install.android.otherBrowsers')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails id="install-android-other-content">
            <Stack spacing={2}>
              <SubHeading level="h4">{t('install.android.samsung')}</SubHeading>
              <GuideSteps hint={null} steps={GUIDES.androidSamsung.steps} />
              <SubHeading level="h4">{t('install.android.firefox')}</SubHeading>
              <GuideSteps hint={null} steps={GUIDES.androidFirefox.steps} />
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Section>
    ),
    desktop: (
      <Section
        key="desktop"
        id="install-desktop"
        title={t('install.sections.desktop')}
        expanded={open.has('desktop')}
        onToggle={() => toggle('desktop')}
      >
        <SubHeading>{t('install.desktop.chromium')}</SubHeading>
        <GuideSteps hint={GUIDES.desktopChromium.hint} steps={GUIDES.desktopChromium.steps} />
        <SubHeading>{t('install.desktop.safari')}</SubHeading>
        <GuideSteps hint={null} steps={GUIDES.macSafari.steps} />
      </Section>
    ),
  };
  const order = [detected, ...SECTION_ORDER.filter((os) => os !== detected)];

  return (
    <Stack spacing={3}>
      <Typography>{t('install.intro')}</Typography>
      <InstallButton showFullGuideLink={false} />
      <Stack spacing={1.5}>{order.map((os) => sections[os])}</Stack>
      <Typography color="text.secondary">{t('install.storeNote')}</Typography>
      <Stack spacing={2} component="section" aria-labelledby="install-troubleshooting">
        <Typography id="install-troubleshooting" variant="h6" component="h2">
          {t('install.sections.troubleshooting')}
        </Typography>
        <Trouble
          title={t('install.trouble.iosMissingTitle')}
          body={t('install.trouble.iosMissing')}
        />
        <Trouble
          title={t('install.trouble.androidMissingTitle')}
          body={t('install.trouble.androidMissing')}
        />
        {updateAndRemove}
      </Stack>
    </Stack>
  );
}
