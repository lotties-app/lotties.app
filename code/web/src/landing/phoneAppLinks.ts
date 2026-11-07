import { webAddress } from './repoUrl';

/*
 * "Get the phone app": the beta-test links of the iPhone and Android apps, chosen by the owner at
 * build time (public values baked into the bundle like VITE_REPO_URL; docs/DEPLOY.md "Phone app
 * links"). Each is hidden when unset or not an http/https address; nothing is ever hardcoded here.
 */

type Env = Record<string, string | undefined>;

export interface PhoneAppLinks {
  /** The public TestFlight invitation link (`https://testflight.apple.com/join/<code>`). */
  testflight: string | null;
  /** The Google Group whose members are the Play closed-testing testers. */
  androidGroup: string | null;
  /** The Play Console opt-in link of the closed test (`https://play.google.com/apps/testing/<package>`). */
  androidOptIn: string | null;
  /** The app's Google Play listing (`https://play.google.com/store/apps/details?id=<package>`). */
  playStore: string | null;
}

export function phoneAppLinks(env: Env = import.meta.env as Env): PhoneAppLinks {
  return {
    testflight: webAddress(env.VITE_TESTFLIGHT_URL),
    androidGroup: webAddress(env.VITE_ANDROID_TESTERS_GROUP_URL),
    androidOptIn: webAddress(env.VITE_ANDROID_OPTIN_URL),
    playStore: webAddress(env.VITE_PLAY_STORE_URL),
  };
}

/** Whether the iPhone card has anything to show. */
export const hasIphone = (links: PhoneAppLinks): boolean => links.testflight !== null;

/** Whether the Android card has anything to show (a step or the install button). */
export const hasAndroid = (links: PhoneAppLinks): boolean =>
  links.androidGroup !== null || links.androidOptIn !== null || links.playStore !== null;
