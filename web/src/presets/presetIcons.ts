import type { ElementType } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import BabyChangingStationRoundedIcon from '@mui/icons-material/BabyChangingStationRounded';
import BathtubRoundedIcon from '@mui/icons-material/BathtubRounded';
import BedtimeRoundedIcon from '@mui/icons-material/BedtimeRounded';
import ChildCareRoundedIcon from '@mui/icons-material/ChildCareRounded';
import ChildFriendlyRoundedIcon from '@mui/icons-material/ChildFriendlyRounded';
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded';
import HotelRoundedIcon from '@mui/icons-material/HotelRounded';
import LocalDrinkRoundedIcon from '@mui/icons-material/LocalDrinkRounded';
import MedicationRoundedIcon from '@mui/icons-material/MedicationRounded';
import NightsStayRoundedIcon from '@mui/icons-material/NightsStayRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import SickRoundedIcon from '@mui/icons-material/SickRounded';
import WbSunnyRoundedIcon from '@mui/icons-material/WbSunnyRounded';
import { ICONS } from '../events/iconRegistry';
import type { Preset } from './types';

/**
 * Icons of the built-in presets (MUI icons-material, rounded). A Map, so a server-provided icon
 * name such as `constructor` never resolves to an inherited member. Kept apart from
 * `events/iconRegistry.ts`, which mirrors the icon names the API accepts for event types.
 */
const PRESET_ICONS: ReadonlyMap<string, ElementType> = new Map<string, ElementType>(
  Object.entries({
    wake_up: WbSunnyRoundedIcon,
    nap: HotelRoundedIcon,
    bedtime: NightsStayRoundedIcon,
    fell_asleep: BedtimeRoundedIcon,
    night_waking: NotificationsActiveRoundedIcon,
    bottle: LocalDrinkRoundedIcon,
    nursing: ChildFriendlyRoundedIcon,
    diaper: BabyChangingStationRoundedIcon,
    medication: MedicationRoundedIcon,
    belly_pain: SickRoundedIcon,
    bath: BathtubRoundedIcon,
    tummy_time: ChildCareRoundedIcon,
    custom: AddRoundedIcon,
  }),
);

/** Icon component of a preset: built-in preset icon, else event type icon, else a fallback. */
export function presetIcon(preset: Pick<Preset, 'icon' | 'builtIn'>): ElementType {
  const own = preset.builtIn ? PRESET_ICONS.get(preset.icon) : ICONS.get(preset.icon);
  return own ?? EventNoteRoundedIcon;
}
