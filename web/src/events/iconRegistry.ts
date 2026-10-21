import type { ElementType } from 'react';
import BabyChangingStationIcon from '@mui/icons-material/BabyChangingStation';
import BathtubIcon from '@mui/icons-material/Bathtub';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import LocalDrinkIcon from '@mui/icons-material/LocalDrink';
import MedicationIcon from '@mui/icons-material/Medication';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import SickIcon from '@mui/icons-material/Sick';
import CakeIcon from '@mui/icons-material/Cake';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import FavoriteIcon from '@mui/icons-material/Favorite';
import StarIcon from '@mui/icons-material/Star';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import OpacityIcon from '@mui/icons-material/Opacity';
import ToysIcon from '@mui/icons-material/Toys';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import WaterDropIcon from '@mui/icons-material/WaterDrop';

/**
 * Material icon names (as stored on event types) to components. A Map, so a server-provided name
 * such as `constructor` never resolves to an inherited object member. Unknown names get a fallback.
 */
export const ICONS: ReadonlyMap<string, ElementType> = new Map<string, ElementType>(
  Object.entries({
    local_drink: LocalDrinkIcon,
    bedtime: BedtimeIcon,
    baby_changing_station: BabyChangingStationIcon,
    bathtub: BathtubIcon,
    child_care: ChildCareIcon,
    medication: MedicationIcon,
    sick: SickIcon,
    restaurant: RestaurantIcon,
    favorite: FavoriteIcon,
    star: StarIcon,
    water_drop: WaterDropIcon,
    opacity: OpacityIcon,
    toys: ToysIcon,
    directions_walk: DirectionsWalkIcon,
    thermostat: ThermostatIcon,
    vaccines: VaccinesIcon,
    cake: CakeIcon,
  }),
);

/** Icon names an event type may use (the custom event type picker offers exactly these). */
export const EVENT_ICON_NAMES: readonly string[] = [...ICONS.keys()];
