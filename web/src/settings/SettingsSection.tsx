import { useState, type ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import { Icon } from '../ui/Icon';

interface Props {
  id: string;
  title: string;
  /** Opens the group; when it turns true later (a link to `#id`) the group opens then too. */
  defaultExpanded?: boolean;
  children: ReactNode;
}

/** One collapsible settings group. Content mounts only while expanded (saves queries). */
export function SettingsSection({ id, title, defaultExpanded = false, children }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [requested, setRequested] = useState(defaultExpanded);
  // A later request to open (the hash changed) opens the group once; the user can still close it.
  if (requested !== defaultExpanded) {
    setRequested(defaultExpanded);
    if (defaultExpanded) setExpanded(true);
  }
  return (
    <Accordion
      expanded={expanded}
      onChange={(_, next) => setExpanded(next)}
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
