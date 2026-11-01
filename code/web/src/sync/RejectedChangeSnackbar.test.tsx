import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../test/renderUi';
import { useTestLocale } from '../test/locale';
import { RejectedChangeSnackbar } from './RejectedChangeSnackbar';
import { announceRejection, dismissRejectionNotice } from './rejectionNotice';

afterEach(() => {
  dismissRejectionNotice();
});

describe('RejectedChangeSnackbar', () => {
  it('shows nothing until a change is refused', () => {
    renderUi(<RejectedChangeSnackbar />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/was not saved/)).toBeNull();
  });

  it('says once that a change to someone else’s entry was not saved', async () => {
    renderUi(<RejectedChangeSnackbar />);
    act(() => announceRejection('notOwned'));
    expect(
      await screen.findByText(
        'A change to an entry someone else added was not saved: you can change only your own entries.',
      ),
    ).toBeTruthy();
  });

  it('says where a change refused after a role change is kept, in pt-BR too', async () => {
    await useTestLocale('pt-BR');
    renderUi(<RejectedChangeSnackbar />);
    act(() => announceRejection('role'));
    expect(
      await screen.findByText(
        'Seu acesso a este bebê mudou e uma alteração não foi salva. Ela ficou guardada em Ajustes > Sincronização.',
      ),
    ).toBeTruthy();
  });

  it('says a suggestion was already decided, in English and in pt-BR', async () => {
    const { unmount } = renderUi(<RejectedChangeSnackbar />);
    act(() => announceRejection('proposalDecided'));
    expect(
      await screen.findByText(
        'This suggestion was already decided, so your change was not applied.',
      ),
    ).toBeTruthy();
    unmount();
    dismissRejectionNotice();

    await useTestLocale('pt-BR');
    renderUi(<RejectedChangeSnackbar />);
    act(() => announceRejection('proposalDecided'));
    expect(
      await screen.findByText(
        'Esta sugestão já foi decidida, então sua alteração não foi aplicada.',
      ),
    ).toBeTruthy();
  });
});
