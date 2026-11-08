/*
 * The parts of the in-app guide `/help/own-database` (OwnDatabaseGuide.tsx), in order, with the
 * number of paragraphs of each (keys `byoDatabase.help.sections.<id>.p1..pN`, same in both
 * languages). The same topics, in more detail and with every error code, are in docs/BYO-DATABASE.md.
 */

export const OWN_DATABASE_HELP_PATH = '/help/own-database';

export const GUIDE_SECTIONS = [
  { id: 'about', paragraphs: 4 },
  { id: 'who', paragraphs: 2 },
  { id: 'keeps', paragraphs: 2 },
  { id: 'limits', paragraphs: 3 },
  { id: 'providers', paragraphs: 1 },
  { id: 'moving', paragraphs: 4 },
  { id: 'down', paragraphs: 3 },
  { id: 'disconnect', paragraphs: 3 },
  { id: 'deletion', paragraphs: 3 },
  { id: 'troubleshooting', paragraphs: 6 },
] as const;

export type GuideSection = (typeof GUIDE_SECTIONS)[number]['id'];

/** The element id of a part of the guide (prefixed: the page shares the document with the app shell). */
export const guideSectionId = (section: GuideSection) => `own-database-${section}`;

/** A link to a part of the guide; the page scrolls to it. */
export const ownDatabaseHelpHref = (section: GuideSection) =>
  `${OWN_DATABASE_HELP_PATH}#${guideSectionId(section)}`;

/**
 * The full guide in the source repository (`VITE_REPO_URL`), or null when the build names none
 * (the link is then left out rather than pointing somewhere wrong).
 */
export function fullGuideUrl(repository: string | null): string | null {
  if (!repository) return null;
  return `${repository.replace(/\/+$/, '')}/blob/main/docs/BYO-DATABASE.md`;
}
