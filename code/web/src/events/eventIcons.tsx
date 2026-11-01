import { Icon, type IconSize } from '../ui/Icon';
import { eventTypeIconName } from './iconRegistry';

/** The icon of an event type (its stored icon name), optionally in the type's own colour. */
export function EventTypeIcon({
  name,
  color,
  size = 24,
}: {
  name: string;
  color?: string;
  size?: IconSize;
}) {
  return <Icon name={eventTypeIconName(name)} size={size} sx={color ? { color } : undefined} />;
}
