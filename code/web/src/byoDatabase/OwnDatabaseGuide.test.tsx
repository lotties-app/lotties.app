import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/locales/en/byoDatabase.json';
import ptBR from '../i18n/locales/pt-BR/byoDatabase.json';
import { findForbiddenClaims } from '../legal/forbiddenClaims';
import { renderUi } from '../test/renderUi';
import {
  fullGuideUrl,
  GUIDE_SECTIONS,
  guideSectionId,
  OWN_DATABASE_HELP_PATH,
  ownDatabaseHelpHref,
} from './guideSections';
import { OwnDatabaseGuide } from './OwnDatabaseGuide';
import { resultMessageOf } from './storeMessages';

/* `/help/own-database`: the in-app guide to bringing your own database (docs/BYO-DATABASE.md). */

const renderGuide = (entry = OWN_DATABASE_HELP_PATH) =>
  renderUi(
    <MemoryRouter initialEntries={[entry]}>
      <OwnDatabaseGuide />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the guide page', () => {
  it('says it is an option, maybe not on yet, and has every part with its anchor', () => {
    renderGuide();
    expect(screen.getByText(/An option, not a change for everyone/)).toBeTruthy();
    expect(screen.getByText(/may not be available to every account yet/)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    for (const { id } of GUIDE_SECTIONS) {
      const heading = document.getElementById(guideSectionId(id));
      expect(heading?.tagName, id).toBe('H2');
      const title = heading?.textContent ?? '';
      expect(within(nav).getByRole('link', { name: title }).getAttribute('href')).toBe(
        `#${guideSectionId(id)}`,
      );
    }
    expect(screen.getByText(/This is not end-to-end encryption/)).toBeTruthy();
  });

  it('keeps the provider guides, marked as not checked on a real account', () => {
    renderGuide();
    for (const name of ['Supabase', 'Neon', 'Other Postgres']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    }
    expect(screen.getAllByText(/not yet checked on a real account/)).toHaveLength(3);
  });

  it('scrolls to the part named in the address', () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    renderGuide(ownDatabaseHelpHref('troubleshooting'));
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe('the guide texts', () => {
  it.each([
    ['en', en],
    ['pt-BR', ptBR],
  ] as const)('has the same parts and paragraph counts in %s', (_, catalog) => {
    const sections = catalog.byoDatabase.help.sections as Record<string, Record<string, string>>;
    expect(Object.keys(sections)).toEqual(GUIDE_SECTIONS.map(({ id }) => id));
    for (const { id, paragraphs } of GUIDE_SECTIONS) {
      const keys = Object.keys(sections[id]).filter((key) => key.startsWith('p'));
      expect(keys, id).toEqual(Array.from({ length: paragraphs }, (_, i) => `p${i + 1}`));
    }
  });

  it.each([
    ['en', en],
    ['pt-BR', ptBR],
  ] as const)('claims nothing Lotties does not do (%s)', (locale, catalog) => {
    expect(findForbiddenClaims(JSON.stringify(catalog), locale)).toEqual([]);
  });
});

describe('links into the guide', () => {
  it('points at a part of the help page', () => {
    expect(ownDatabaseHelpHref('troubleshooting')).toBe(
      '/help/own-database#own-database-troubleshooting',
    );
  });

  it('links the full guide only when the build names a repository', () => {
    expect(fullGuideUrl(null)).toBeNull();
    expect(fullGuideUrl('https://github.com/lotties-app/lotties/')).toBe(
      'https://github.com/lotties-app/lotties/blob/main/docs/BYO-DATABASE.md',
    );
  });

  it.each([
    ['store_moving', 'moving'],
    ['store_move_in_progress', 'moveInProgress'],
    ['store_move_not_needed', 'moveNotNeeded'],
    ['store_owner_only', 'ownerOnly'],
    ['store_in_use', 'inUse'],
    ['store_not_owned', 'notOwned'],
    ['store_account_deleting', 'accountDeleting'],
    ['account_deletion_in_progress', 'accountDeleting'],
  ])('explains %s in plain words', (code, message) => {
    expect(resultMessageOf(code)).toBe(message);
    expect(en.byoDatabase.results).toHaveProperty(message);
    expect(ptBR.byoDatabase.results).toHaveProperty(message);
  });
});
