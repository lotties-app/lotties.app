import { Suspense, lazy } from 'react';
import type { KcContext } from './KcContext';
import { useI18n } from './i18n';
import DefaultPage from 'keycloakify/login/DefaultPage';
import Template from './Template';
import { classes } from './classes';
import './styles/theme.css';

const UserProfileFormFields = lazy(() => import('keycloakify/login/UserProfileFormFields'));

const doMakeUserConfirmPassword = true;

/**
 * Every page goes through Keycloakify's DefaultPage with our Template and class map. Pages that need
 * different markup can be ejected later (`npx keycloakify eject-page`) and added to a switch here.
 */
export default function KcPage(props: { kcContext: KcContext }) {
  const { kcContext } = props;
  const { i18n } = useI18n({ kcContext });

  return (
    <Suspense>
      <DefaultPage
        kcContext={kcContext}
        i18n={i18n}
        classes={classes}
        Template={Template}
        doUseDefaultCss={false}
        UserProfileFormFields={UserProfileFormFields}
        doMakeUserConfirmPassword={doMakeUserConfirmPassword}
      />
    </Suspense>
  );
}
