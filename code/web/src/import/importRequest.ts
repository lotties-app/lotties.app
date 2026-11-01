import { ISSUES_URL } from '../legal/privacyConfig';

const TITLE = 'Import request: <app name>';

const BODY = `I would like to import my baby's history from another app into Lotties.

App name and version:
Where I export it (menu, file format):

Please do not attach real data. To add an importer we need the structure of the export: the file format, the columns or fields, how dates, times and durations are written, and a few made-up example rows.`;

/**
 * A prefilled "new issue" page of the project's tracker asking for an importer. Nothing is sent from
 * the app: the person reads it on GitHub and submits it there, with their own account.
 */
export function importRequestUrl(): string {
  const params = new URLSearchParams({ title: TITLE, body: BODY, labels: 'import-request' });
  return `${ISSUES_URL}/new?${params.toString()}`;
}
