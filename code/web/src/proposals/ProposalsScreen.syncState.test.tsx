import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prescription, Proposal } from '../db/models';
import type { EntitySyncState } from '../db/queries';
import { I18nProvider } from '../i18n/I18nProvider';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { babyFor, proposal } from './proposalKit';
import { ProposalsScreen } from './ProposalsScreen';

/*
 * "Waiting to sync" on "My proposals" comes from the outbox, read by its own live query, apart
 * from the proposals' query. Either may resolve first. Until the outbox is read the screen must
 * not draw the rows: a proposal written offline would otherwise show as if it had reached the
 * parents. The three queries are stubbed here so their order is fixed, not left to timing.
 */

const data = vi.hoisted(() => ({
  proposals: undefined as Proposal[] | undefined,
  prescriptions: undefined as Prescription[] | undefined,
  states: undefined as Map<string, EntitySyncState> | undefined,
}));

vi.mock('./useProposals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useProposals')>()),
  useProposals: () => data.proposals,
  useProposalCommands: () => ({}),
}));

vi.mock('../db/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/hooks')>()),
  useAllPrescriptions: () => data.prescriptions,
  useEntitySyncStates: () => data.states,
}));

afterEach(() => {
  data.proposals = undefined;
  data.prescriptions = undefined;
  data.states = undefined;
});

function screenFor() {
  return (
    <I18nProvider>
      <AppThemeProvider>
        <MemoryRouter>
          <ProposalsScreen baby={babyFor('Doctor')} />
        </MemoryRouter>
      </AppThemeProvider>
    </I18nProvider>
  );
}

describe('the sync state of a proposal written offline', () => {
  it('is known before the row is drawn, so it never shows as sent first', () => {
    data.proposals = [proposal('p-offline')];
    data.prescriptions = [];

    const view = render(screenFor());

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();

    data.states = new Map([['p-offline', 'pending']]);
    view.rerender(screenFor());

    const [item] = screen.getAllByRole('listitem');
    expect(within(item).getByText('Waiting to sync')).toBeTruthy();
  });

  it('shows no waiting mark once the outbox is read and holds nothing for it', () => {
    data.proposals = [proposal('p-sent')];
    data.prescriptions = [];
    data.states = new Map();

    render(screenFor());

    const [item] = screen.getAllByRole('listitem');
    expect(within(item).queryByText('Waiting to sync')).toBeNull();
  });
});
