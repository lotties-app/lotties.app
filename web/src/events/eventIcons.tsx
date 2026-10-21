import { createElement } from 'react';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { ICONS } from './iconRegistry';

export function EventTypeIcon({
  name,
  color,
  fontSize,
}: {
  name: string;
  color?: string;
  fontSize: number;
}) {
  return createElement(ICONS.get(name) ?? EventNoteIcon, { sx: { fontSize, color } });
}
