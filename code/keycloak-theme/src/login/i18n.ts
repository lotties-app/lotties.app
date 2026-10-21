/* eslint-disable @typescript-eslint/no-unused-vars */
import { i18nBuilder } from 'keycloakify/login';
import type { ThemeName } from '../kc.gen';

/**
 * Theme specific messages (every string the theme adds on top of Keycloak's own message bundle).
 * Keycloak's messages are English by default and pt-BR through keycloakify's translation set.
 */
const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({
    en: {
      // Tone of voice of the app: warm, sentence case.
      loginAccountTitle: 'Welcome back',
      doLogIn: 'Sign in',
      doForgotPassword: 'Forgot password?',
      noAccount: 'New here?',
      doRegister: 'Create an account',
      registerTitle: 'Create your account',
      passwordNew: 'New password',
      // Placeholder: replace it in Realm settings > Localization (a realm override wins over the theme).
      termsText:
        "<p>Lotties is a small, open source app to keep track of a baby's day. Please keep your sign-in details private and use the app only to care for the babies you share with others.</p>",
      appName: 'Lotties',
      heroTagline: "Track your baby's day, together",
      heroNote: 'Sleep, feeds and diapers in one calm place.',
      heroArtLabel: 'A cloud with a crescent moon, and a feeding bottle',
      skipToContent: 'Skip to the form',
      pageFooter: 'Lotties is free and open source software.',
    },
    'pt-BR': {
      loginAccountTitle: 'Bem-vindo de volta',
      doLogIn: 'Entrar',
      doForgotPassword: 'Esqueceu a senha?',
      noAccount: 'Primeira vez por aqui?',
      doRegister: 'Criar uma conta',
      registerTitle: 'Crie sua conta',
      passwordNew: 'Nova senha',
      termsText:
        '<p>Lotties é um app pequeno e de código aberto para acompanhar o dia de um bebê. Mantenha seus dados de acesso em sigilo e use o app apenas para cuidar dos bebês que você compartilha com outras pessoas.</p>',
      appName: 'Lotties',
      heroTagline: 'Acompanhe o dia do seu bebê, em conjunto',
      heroNote: 'Sono, mamadas e fraldas em um só lugar tranquilo.',
      heroArtLabel: 'Uma nuvem com uma lua crescente e uma mamadeira',
      skipToContent: 'Pular para o formulário',
      pageFooter: 'Lotties é um software livre e de código aberto.',
    },
  })
  .build();

type I18n = typeof ofTypeI18n;

export { useI18n, type I18n };
