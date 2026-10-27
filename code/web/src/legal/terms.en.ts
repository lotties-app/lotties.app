import { privacyEn } from './privacy.en';
import type { TermsDocument } from './termsTypes';

/*
 * Terms of use, English (docs/CONSENT-AND-TERMS-DRAFT.md section 5; a draft for the lawyer, not legal advice). Say only what the
 * code does. A change that alters the meaning of a sentence is a material change: raise the terms version and add an entry to
 * consentVersions.json (consentVersions.test.ts fails until the text digest follows).
 */
export const termsEn: TermsDocument = {
  locale: 'en',
  clauses: [
    {
      id: 'who',
      title: 'Who we are',
      text: 'Lotties is a free, open source (AGPL-3.0) baby routine tracker. The service is run by {controller}. Contact: {contact}.',
    },
    {
      id: 'beta',
      title: 'Beta',
      text: 'The service is in testing and offered "as is": it can change, fail, be unavailable or be shut down, and data can be lost. Keep copies of what matters (Hub > Export data). We will give reasonable notice before shutting the service down.',
    },
    {
      id: 'who-may-use',
      title: 'Who may use it',
      text: "Adults (18+). Whoever records a child's data declares being the child's parent, legal guardian or an adult they authorised.",
    },
    {
      id: 'account',
      title: 'Your account',
      text: 'You are responsible for what happens in your account and for the people you give access. Keep your password safe and tell us if you suspect unauthorised access.',
    },
    {
      id: 'data',
      title: 'Your data',
      text: 'The data you record stays yours. You allow us to store it, sync it and show it to the people you choose, only to run the service. How we handle personal data: the [Privacy policy](/privacy).',
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      text: "Do not use Lotties for anything illegal, to harm others or the service, or to record a child's data without the right to do so. Do not try to reach other families' data.",
    },
    {
      id: 'health',
      title: 'Health',
      text: 'Lotties keeps a record and shows patterns from what you logged. It does not diagnose, recommend treatment or act as a medical device. Medicine reminders are reminders of what you registered, not recommendations from Lotties. For any health concern, talk to your pediatrician or pharmacist; in an emergency call your local emergency number.',
    },
    {
      id: 'integrations',
      title: 'Integrations',
      text: 'Alexa, the AI assistant, notifications and address lookup are third-party services you choose to turn on, each with its own rules.',
    },
    {
      id: 'security',
      title: 'Security and incidents',
      text: 'We use appropriate security measures, but no system is fully secure. If a relevant security incident happens we will tell the people affected and the data protection authority within the legal deadlines.',
    },
    {
      id: 'changes',
      title: 'Changes',
      text: 'We may change these Terms. Material changes ask for consent again; minor ones show as a notice.',
    },
    {
      id: 'ending',
      title: 'Ending',
      text: 'You can delete your account at any time in Settings. We may suspend an account that breaks these Terms or puts the service or other people at risk.',
    },
    {
      id: 'liability',
      title: 'Liability',
      text: 'To the extent the law allows, we are not liable for losses from failures, unavailability or use of a service in testing, except in cases of willful misconduct or gross negligence and where the law does not allow limiting liability (for example data-subject and consumer rights).',
    },
    {
      id: 'open-source',
      title: 'Open source',
      text: 'The source code is at [the project repository]({repoUrl}) under the AGPL-3.0; these Terms do not limit the rights that licence gives you over the code.',
    },
    {
      id: 'law',
      title: 'Law',
      text: 'Brazilian law applies to these Terms.',
    },
  ],
  fallbacks: privacyEn.fallbacks,
};
