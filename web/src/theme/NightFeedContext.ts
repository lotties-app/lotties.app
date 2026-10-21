import { createContext, useContext } from 'react';
import type { NightFeedSetting } from './nightFeed';

export interface NightFeedApi {
  /** Settings > Appearance > Night feed. */
  setting: NightFeedSetting;
  setSetting: (setting: NightFeedSetting) => void;
  /** The night scheme is showing. */
  active: boolean;
  /** The "Switch to night view?" banner should be offered. */
  suggested: boolean;
  /** Banner "Switch": night view on until the next window boundary. */
  accept: () => void;
  /** Banner "Not now": no more offers in this window. */
  dismiss: () => void;
  /** Quick toggle (account menu): explicit on/off until the next window boundary. */
  toggle: () => void;
}

const noop = () => {};

/** Without a provider (isolated component tests) the night view is simply off. */
const INERT: NightFeedApi = {
  setting: 'off',
  setSetting: noop,
  active: false,
  suggested: false,
  accept: noop,
  dismiss: noop,
  toggle: noop,
};

export const NightFeedContext = createContext<NightFeedApi>(INERT);

export function useNightFeed(): NightFeedApi {
  return useContext(NightFeedContext);
}
