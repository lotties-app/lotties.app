import { useEffect } from 'react';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import { clsx } from 'keycloakify/tools/clsx';
import type { TemplateProps } from 'keycloakify/login/TemplateProps';
import { getKcClsx } from 'keycloakify/login/lib/kcClsx';
import { useSetClassName } from 'keycloakify/tools/useSetClassName';
import { useInitialize } from 'keycloakify/login/Template.useInitialize';
import type { I18n } from './i18n';
import type { KcContext } from './KcContext';
import { HeroArt } from './art/HeroArt';

const GLYPHS = {
  success: 'M8 12.5l3 3 5-6',
  info: 'M12 11v5M12 8v.01',
  warning: 'M12 9.5v4M12 16.5v.01',
  error: 'M9.5 9.5l5 5M14.5 9.5l-5 5',
} as const;

function AlertIcon({ type }: { type: keyof typeof GLYPHS }) {
  return (
    <svg className="br-alert-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {type === 'warning' ? (
        <path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : (
        <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      )}
      <path d={GLYPHS[type]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Template(props: TemplateProps<KcContext, I18n>) {
  const {
    displayInfo = false,
    displayMessage = true,
    displayRequiredFields = false,
    headerNode,
    socialProvidersNode = null,
    infoNode = null,
    documentTitle,
    bodyClassName,
    kcContext,
    i18n,
    doUseDefaultCss,
    classes,
    children,
  } = props;

  const { kcClsx } = getKcClsx({ doUseDefaultCss, classes });
  const { msg, msgStr, currentLanguage, enabledLanguages } = i18n;
  const { realm, auth, url, message, isAppInitiatedAction } = kcContext;

  useEffect(() => {
    document.title = documentTitle ?? msgStr('loginTitle', realm.displayName || realm.name);
    document.documentElement.lang = currentLanguage.languageTag;
  }, [documentTitle, currentLanguage.languageTag]);

  // Stock pages set positive tabindex values (2, 3, 4...), which jump ahead of the skip link and the
  // language switcher. DOM order already is the visual order, so drop them.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('[tabindex]').forEach((el) => {
      if (el.tabIndex > 0) el.removeAttribute('tabindex');
    });
  });

  useSetClassName({ qualifiedName: 'html', className: kcClsx('kcHtmlClass') });
  useSetClassName({ qualifiedName: 'body', className: bodyClassName ?? kcClsx('kcBodyClass') });

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
  if (!isReadyToRender) return null;

  const showMessage = displayMessage && message !== undefined && (message.type !== 'warning' || !isAppInitiatedAction);
  const showUsername = auth !== undefined && auth.showUsername && !auth.showResetCredentials;

  const title = !showUsername ? (
    <h1 id="kc-page-title" className="br-title">
      {headerNode}
    </h1>
  ) : (
    <div id="kc-username" className="br-user-chip">
      <span id="kc-attempted-username" className="br-user-chip__name">
        {auth.attemptedUsername}
      </span>
      <a id="reset-login" href={url.loginRestartFlowUrl} aria-label={msgStr('restartLoginTooltip')} title={msgStr('restartLoginTooltip')}>
        <i className={kcClsx('kcResetFlowIcon')} aria-hidden="true" />
        <span className="br-sr-only">{msg('restartLoginTooltip')}</span>
      </a>
    </div>
  );

  return (
    <div className="br-page">
      <a className="br-skip" href="#kc-content">
        {msg('skipToContent')}
      </a>
      <aside className="br-hero">
        <HeroArt label={msgStr('heroArtLabel')} />
        <p className="br-wordmark">{msg('appName')}</p>
        <p className="br-tagline">{msg('heroTagline')}</p>
        <p className="br-note">{msg('heroNote')}</p>
      </aside>

      <main className="br-main">
        <div className="br-card">
          <header className="br-card-header">
            {enabledLanguages.length > 1 && (
              <nav className="br-locale" id="kc-locale" aria-label={msgStr('languages')}>
                {enabledLanguages.length <= 3 ? (
                  <ul className="br-locale-pills">
                    {enabledLanguages.map(({ languageTag, label, href }) => (
                      <li key={languageTag}>
                        <a
                          href={href}
                          lang={languageTag}
                          hrefLang={languageTag}
                          aria-current={languageTag === currentLanguage.languageTag ? 'true' : undefined}
                          className="br-pill"
                        >
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <details className="br-locale-menu">
                    <summary className="br-pill">{currentLanguage.label}</summary>
                    <ul className="br-locale-list">
                      {enabledLanguages.map(({ languageTag, label, href }) => (
                        <li key={languageTag}>
                          <a href={href} lang={languageTag} aria-current={languageTag === currentLanguage.languageTag ? 'true' : undefined}>
                            {label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </nav>
            )}
            {displayRequiredFields ? (
              <div className="br-required">
                {title}
                <p className="br-required__note">
                  <span aria-hidden="true">* </span>
                  {msg('requiredFields')}
                </p>
              </div>
            ) : (
              title
            )}
          </header>

          <div id="kc-content" tabIndex={-1}>
            <div id="kc-content-wrapper">
              {showMessage && (
                <div
                  className={clsx('br-alert', `br-alert--${message.type}`)}
                  role={message.type === 'error' || message.type === 'warning' ? 'alert' : 'status'}
                  aria-live={message.type === 'error' ? 'assertive' : 'polite'}
                >
                  <AlertIcon type={message.type} />
                  <span className="br-alert-title" dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }} />
                </div>
              )}
              {children}
              {auth !== undefined && auth.showTryAnotherWayLink && (
                <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                  <div className="br-field">
                    <input type="hidden" name="tryAnotherWay" value="on" />
                    <a
                      href="#"
                      id="try-another-way"
                      onClick={(event) => {
                        document.forms['kc-select-try-another-way-form' as never].requestSubmit();
                        event.preventDefault();
                        return false;
                      }}
                    >
                      {msg('doTryAnotherWay')}
                    </a>
                  </div>
                </form>
              )}
              {socialProvidersNode}
              {displayInfo && (
                <div id="kc-info" className="br-signup">
                  <div id="kc-info-wrapper" className="br-info-wrap">
                    {infoNode}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="br-footer">{msg('pageFooter')}</p>
      </main>
    </div>
  );
}
