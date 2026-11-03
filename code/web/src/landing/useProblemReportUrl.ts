import { useLocation } from 'react-router-dom';
import { readBuildInfo } from '../config/buildInfo';
import { displayVersion } from '../config/versionInfo';
import { useLocale } from '../i18n/useLocale';
import { nativePlatform } from '../platform/nativeApp';
import { issuePlatform, problemReportUrl } from './outboundLinks';

/**
 * The "Report a problem" address of the footer and Hub > About (`problemReportUrl`): on GitHub the
 * bug form prefilled with the app version, the platform, the UI language and the current route
 * path without ids; the `mailto:` fallback carries `subject` and the version only.
 */
export function useProblemReportUrl(subject: string): string | null {
  const { pathname } = useLocation();
  const { locale } = useLocale();
  const version = displayVersion(readBuildInfo().version);
  return problemReportUrl(
    undefined,
    { subject, body: `Lotties ${version}` },
    { version, platform: issuePlatform(nativePlatform()), language: locale, screen: pathname },
  );
}
