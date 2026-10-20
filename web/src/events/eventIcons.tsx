import { createElement, type ElementType } from 'react';
import BabyChangingStationIcon from '@mui/icons-material/BabyChangingStation';
import BathtubIcon from '@mui/icons-material/Bathtub';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import EventNoteIcon from '@mui/icons-material/EventNote';
import LocalDrinkIcon from '@mui/icons-material/LocalDrink';
import MedicationIcon from '@mui/icons-material/Medication';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import SickIcon from '@mui/icons-material/Sick';

/** Material icon names (as stored on event types) to components. Unknown names get a fallback. */
const ICONS: Record<string, ElementType> = {
  local_drink: LocalDrinkIcon,
  bedtime: BedtimeIcon,
  baby_changing_station: BabyChangingStationIcon,
  bathtub: BathtubIcon,
  child_care: ChildCareIcon,
  medication: MedicationIcon,
  sick: SickIcon,
  restaurant: RestaurantIcon,
};

export function EventTypeIcon({
  name,
  color,
  fontSize,
}: {
  name: string;
  color?: string;
  fontSize: number;
}) {
  return createElement(ICONS[name] ?? EventNoteIcon, { sx: { fontSize, color } });
}
