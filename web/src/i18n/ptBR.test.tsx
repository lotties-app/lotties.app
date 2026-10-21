import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import LandingPage from '../landing/LandingPage';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import type { BabyRoutineDb } from '../db/database';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { DayPage } from '../pages/DayPage';
import { describeReason } from '../predictions/predictionModel';
import type { PredictionDto } from '../sync/contract';
import { AuthTestWrapper } from '../test/AuthTestWrapper';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { BELLY, DIAPER, FEEDING, seedBaby } from '../test/seed';
import { eventTypeText } from './eventTypeText';
import { I18nProvider } from './I18nProvider';
import { LOCALE_STORAGE_KEY } from './localeStorage';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const at = (h: number, m = 0, daysAgo = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).toISOString();
};

function event(
  id: string,
  typeId: string,
  startedAt: string,
  endedAt: string | null,
  payload = {},
) {
  return {
    id,
    babyId: BABY_ID,
    typeId,
    startedAt,
    endedAt,
    payload,
    notes: null,
    createdBy: 'user-1',
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
}

function renderLogin() {
  render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthTestWrapper auth={fakeAuth({ isAuthenticated: false, user: null })}>
          <LandingPage />
        </AuthTestWrapper>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

describe('pt-BR screens', () => {
  beforeEach(async () => {
    await useTestLocale('pt-BR');
  });

  it('translates the landing page and sets the document language', async () => {
    renderLogin();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Acompanhe o dia do seu bebê/ }),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Entrar' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Criar uma conta' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Como funciona' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(document.title).toBe('Baby Routine: acompanhe o dia do seu bebê, em conjunto');
  });

  it('translates the Now screen: the question, the tiles and the navigation', async () => {
    await seedBaby(db);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    await db.events.put(event('wet', DIAPER, hourAgo, hourAgo, { content: 'WET' }));
    renderWithDb(db, <HomePage />);
    expect(await screen.findByRole('heading', { name: 'Agora' })).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: 'O que Lia está fazendo agora?' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dormindo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Mamada/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Fralda/ }).textContent).toMatch(/Xixi/);
    expect(screen.getByRole('button', { name: /^Mais/ })).toBeTruthy();
  });

  it('translates the timeline: day labels, type names, options and durations', async () => {
    await seedBaby(db);
    await db.events.bulkPut([
      event('feed', FEEDING, at(8), at(8, 45)),
      event('belly', BELLY, at(7), at(7), { intensity: 3 }),
      // Upper-case values written by older clients still resolve.
      event('diaper', DIAPER, at(20, 0, 1), at(20, 0, 1), { content: 'DIRTY' }),
    ]);
    renderWithDb(db, <DayPage />);

    expect(await screen.findByRole('heading', { name: 'Dia' })).toBeTruthy();
    const today = await screen.findByRole('list', { name: /^Hoje, / });
    expect(within(today).getByText('08:00 – 08:45')).toBeTruthy();
    expect(within(today).getByText('45 min')).toBeTruthy();
    expect(within(today).getByText('Intensidade 3/5')).toBeTruthy();
    expect(within(today).getByText('Dor de barriga')).toBeTruthy();
    // Swiping right shows the previous day.
    fireEvent.touchStart(today.parentElement!, { touches: [{ clientX: 40, clientY: 100 }] });
    fireEvent.touchEnd(today.parentElement!, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    const yesterday = await screen.findByRole('list', { name: /^Ontem, / });
    expect(within(yesterday).getByText('Cocô')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Semana' })).toBeTruthy();
  });

  it('translates the settings and switches language instantly', async () => {
    await seedBaby(db);
    renderWithDb(db, <SettingsPage />, { api: fakeApi().api });
    expect(await screen.findByRole('heading', { name: 'Ajustes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Idioma' }));
    const select = await screen.findByRole('combobox', { name: 'Idioma' });
    expect(within(select).getByRole('option', { name: 'Padrão do sistema' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'English' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Português (Brasil)' })).toBeTruthy();

    fireEvent.change(select, { target: { value: 'en' } });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });
});

describe('pt-BR texts outside components', () => {
  beforeEach(async () => {
    await useTestLocale('pt-BR');
  });

  it('maps problem codes to localized messages and never shows server detail', () => {
    const coded = new ApiError(409, { code: 'invite_expired', detail: 'Raw server text' });
    expect(describeApiError(coded)).toBe('Este convite expirou. Peça um novo link de convite.');
    expect(describeApiError(new ApiError(400, { code: 'weird', detail: 'Raw server text' }))).toBe(
      'O servidor não conseguiu concluir o pedido. Tente de novo mais tarde.',
    );
    expect(describeApiError(new TypeError('Failed to fetch'))).toContain('sem conexão');
  });

  it('renders the prediction reason from the structured basis', () => {
    const prediction: PredictionDto = {
      typeKey: 'sleep',
      nextStart: { earliest: at(13), expected: at(14), latest: at(15) },
      expectedDuration: { minutes: 85, sampleCount: 40 },
      confidence: 'Medium',
      sampleCount: 42,
      reason: 'Median every 3h 10m over the last 14 days (night, age 3-6m), 42 samples.',
      basis: {
        kind: 'StartInterval',
        medianGapMinutes: 190,
        lookBackDays: 14,
        ageBand: '3-6m',
        dayPhase: 'night',
        assumesEventInProgressEnds: false,
      },
    };
    expect(describeReason(prediction)).toBe(
      'Em geral a cada 3 h 10 min, com base nos últimos 14 dias. 42 registros usados. ' +
        'Só foram usados eventos da noite. Só foram usados eventos da faixa de idade 3 a 6 meses. ' +
        'Duração típica de 1 h 25 min (a partir de 40 registros).',
    );
    // Without a usable basis the server's English sentence is the fallback.
    expect(describeReason({ ...prediction, basis: {} })).toBe(prediction.reason);
  });

  it('translates built-in names and keeps user-created and unknown ones as they are', () => {
    const base = { key: 'feeding', name: 'Feeding' };
    expect(eventTypeText.typeName({ ...base, babyId: null })).toBe('Alimentação');
    expect(eventTypeText.typeName({ ...base, babyId: BABY_ID })).toBe('Feeding');
    expect(eventTypeText.typeName({ key: 'future', name: 'Future', babyId: null })).toBe('Future');
    const type = { key: 'feeding', babyId: null };
    expect(eventTypeText.optionLabel(type, { key: 'method' }, 'BREAST')).toBe('Peito');
    // Never an inherited catalog member; an untranslated built-in code is humanized, not raw.
    expect(eventTypeText.optionLabel(type, { key: 'method' }, 'constructor')).toBe('Constructor');
    expect(eventTypeText.optionLabel(type, { key: 'method' }, 'tube_FEEDING')).toBe('Tube feeding');
    const custom = { key: 'feeding', babyId: BABY_ID };
    expect(eventTypeText.optionLabel(custom, { key: 'method' }, 'tube_feeding')).toBe(
      'tube_feeding',
    );
    expect(eventTypeText.fieldLabel(type, { key: 'amount_ml', label: 'Amount' })).toBe(
      'Quantidade',
    );
  });
});

describe('language setting', () => {
  it('follows navigator.languages for the system default (pt maps to pt-BR)', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['pt-PT', 'en']);
    renderLogin();
    expect((await screen.findAllByRole('button', { name: 'Entrar' })).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.documentElement.lang).toBe('pt-BR'));
  });

  it('falls back to English for unsupported languages', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    renderLogin();
    expect((await screen.findAllByRole('button', { name: 'Sign in' })).length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe('en');
  });

  it('lets an explicit choice override the system language', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['pt-BR']);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    renderLogin();
    expect((await screen.findAllByRole('button', { name: 'Sign in' })).length).toBeGreaterThan(0);
  });
});
