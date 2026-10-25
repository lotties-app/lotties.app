import { createContext } from 'react';
import type { UnitSetting, UnitSystem } from './system';

export interface UnitsApi {
  /** What the person chose. */
  setting: UnitSetting;
  /** What is in use (`auto` resolved from the device locale). */
  system: UnitSystem;
  /** A local choice the server has not confirmed yet (offline, or a server without the route). */
  pending: boolean;
  setSetting: (next: UnitSetting) => void;
}

/** `null` outside the provider (isolated component tests, signed out): the module state applies. */
export const UnitsContext = createContext<UnitsApi | null>(null);
