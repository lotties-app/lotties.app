import type { ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import { Icon } from '../ui/Icon';

interface Props {
  id: string;
  title: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}

/** One collapsible settings group. Content mounts only while expanded (saves queries). */
export function SettingsSection({ id, title, defaultExpanded = false, children }: Props) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      slotProps={{ transition: { unmountOnExit: true } }}
    >
      <AccordionSummary
        expandIcon={<Icon name="expand" />}
        aria-controls={`${id}-content`}
        id={`${id}-header`}
        sx={{ minHeight: 56 }}
      >
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={`${id}-content`}>{children}</AccordionDetails>
    </Accordion>
  );
}
