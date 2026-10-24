import type { PolicyDocument } from './policyTypes';

/*
 * The privacy policy in English. Facts behind every sentence: docs/design/33-privacy-audit.md. A change of
 * meaning here needs the same change in privacy.pt-BR.ts, a new version and date in privacyPolicy.ts, and
 * the audit updated. Conventions for links and `{values}`: policyTypes.ts.
 */
export const privacyEn: PolicyDocument = {
  locale: 'en',
  summary: {
    title: 'In short',
    groups: [
      {
        title: 'What we collect',
        items: [
          'Your sign-in account: name, email and password, kept by our own sign-in server.',
          'What you and the people you invite record about your baby, including health information such as medicines and vaccines.',
          'What the service needs to work: reminder settings if you turn reminders on, and technical logs.',
        ],
      },
      {
        title: 'What we do not do',
        items: [
          'No advertising, no analytics or tracking tools, and no selling of data.',
          'No medical advice: Lotties is not a medical device.',
          'Your data reaches other companies only when you use a feature that needs them, such as reminders or Alexa.',
        ],
      },
      {
        title: 'Your key rights',
        items: [
          'Download your data: [Hub > Export data](/hub/export).',
          'Delete your account and your data: [Settings > Account and data](/settings#account).',
          'Ask, correct or complain: [contact us](#privacy-contact) or the ANPD.',
        ],
      },
    ],
  },
  sections: [
    {
      id: 'controller',
      title: 'Who is responsible',
      blocks: [
        {
          kind: 'p',
          text: "This policy explains how the Lotties service at lotties.app and its iOS and Android apps handle personal data. Responsible for that data (the controller, or controlador, under Brazil's General Data Protection Law, the LGPD): {controller}.",
        },
        { kind: 'p', text: 'Contact: {contact}. Data protection contact (encarregado): {dpo}.' },
        {
          kind: 'p',
          text: 'Lotties runs on servers that the maintainer operates in a home lab, on their own hardware, not on a cloud provider: the app, its database and the sign-in server (Keycloak).',
        },
        {
          kind: 'p',
          text: "Lotties is free, open-source software (AGPL-3.0). Anyone can run their own copy from the [source code]({repoUrl}). A copy run by someone else is that operator's responsibility, with its own privacy terms; this policy covers only lotties.app.",
        },
      ],
    },
    {
      id: 'data',
      title: 'What we collect and why',
      blocks: [
        {
          kind: 'p',
          text: 'We collect only what the features you use need. The table lists each kind of information, what it includes and why we use it.',
        },
        {
          kind: 'table',
          id: 'data',
          caption: 'Information Lotties handles',
          columns: ['Information', 'What it includes', 'Why we use it'],
          rows: [
            {
              id: 'account',
              cells: [
                'Your sign-in account',
                'The details you register with at our sign-in server (Keycloak), such as your name and email address, and your password, which Keycloak keeps only in a protected form (a one-way hash). The Lotties server keeps just an internal id and your display name; it never reads your email. The app on your device receives your name and email from the sign-in server.',
                'To let you sign in on your devices, and to show your name to the people you share a baby with.',
              ],
            },
            {
              id: 'babyProfile',
              cells: [
                "Your baby's profile",
                'Name and date of birth and, if you fill them in, vaccine details: the vaccine network you use (public, or also private), weeks of pregnancy at birth, and whether the mother had the RSV vaccine in pregnancy.',
                "To show ages and the day's routine, and the vaccine schedule that fits your baby.",
              ],
            },
            {
              id: 'records',
              cells: [
                'Daily records',
                'What you and the people you invite log: sleep, feeds and bottles (amounts, the formula used), diapers, baths, tummy and outdoor time, crying spells, milestones, the notes you add to entries, your own entry types and running timers.',
                'This is what the app is for: to keep the log, sync it across devices and people, and calculate summaries and estimates for you.',
              ],
            },
            {
              id: 'health',
              cells: [
                'Health information about your baby',
                'Medicines and prescriptions you enter and the doses given, temperatures, symptoms, belly pain, spit-up, teething, weight, length and head size, vaccinations (date, clinic, batch, who gave it), appointments (time, place, doctor, notes, outcome), formulas, and the notes and suggestions of a doctor you invited.',
                "To keep your baby's health log, show the medicine and vaccine schedules from what you entered, and send the reminders you turn on. This is sensitive personal data under the LGPD.",
              ],
            },
            {
              id: 'careProviders',
              cells: [
                'Doctors and clinics you save',
                'The name, specialty, professional registration (such as a CRM number), clinic, address, phone, WhatsApp, email, website and notes of the professionals and places you add.',
                'To keep their contacts at hand and fill in appointments quickly.',
              ],
            },
            {
              id: 'doctorProfile',
              cells: [
                'Health professional profile',
                'If you declare that you are a health professional: the name families see, your specialty and your registration number. It is self-declared: Lotties does not verify it.',
                "So that the families who invite you as their baby's doctor know who you are.",
              ],
            },
            {
              id: 'sharing',
              cells: [
                'Sharing and roles',
                'Who belongs to each baby and with which role, the sections shared with each doctor, and invites (an invite is a link you share yourself; we store only a one-way fingerprint of it, its role and when it expires).',
                'To share a baby only with the people you choose, with the access you choose.',
              ],
            },
            {
              id: 'accessLog',
              cells: [
                'Doctor access log',
                "When a doctor you invited opens your baby's data: who, with which role and when (at most one entry per hour).",
                "So that the baby's owner can see when each doctor looked.",
              ],
            },
            {
              id: 'notifications',
              cells: [
                'Reminders',
                'If you turn on notifications on a device: the push address your browser gives us and its keys, a device label (such as "Chrome on Android"), language, time zone, quiet hours, the reminders you chose, and a delivery record (ids, kind, time and status, never the text).',
                'To send the reminders you asked for, at your local time.',
              ],
            },
            {
              id: 'assistants',
              cells: [
                'Voice assistant (Alexa)',
                'The baby you choose for voice commands (Settings > Voice assistants) and, if you enable and link the Lotties Alexa skill, in each request from Amazon the command and its values (such as "bottle" and "120 ml"), the language and a sign-in token for your account.',
                'To log entries and answer questions by voice.',
              ],
            },
            {
              id: 'technical',
              cells: [
                'Technical logs',
                'What our servers record to run the service: internal ids of the account and baby involved, the kind of action and its result, and errors. The web server also records the network address (IP) a page request came from, the page and the browser type. The text of an address search can appear in the log of that request.',
                'To keep the service working, investigate problems and protect it from abuse.',
              ],
            },
            {
              id: 'device',
              cells: [
                'On your device',
                "A copy of your babies' records for offline use, the changes waiting to be sent, your sign-in session and your preferences.",
                'So that the app works without a connection and opens quickly. See [Cookies and storage on your device](#privacy-device-storage).',
              ],
            },
            {
              id: 'backups',
              cells: [
                'Copies and exports',
                'Copies of the database that the maintainer makes before updates that change it, and the files you export from the app.',
                'To recover the service if an update fails, and to let you keep or move your data.',
              ],
            },
          ],
        },
        {
          kind: 'note',
          text: 'Lotties does not ask for your location, contacts, camera, photos or microphone. The app contains no advertising, analytics or crash-reporting tools.',
        },
      ],
    },
    {
      id: 'other-people',
      title: 'Information about other people',
      blocks: [
        {
          kind: 'p',
          text: "Some of what you enter is about other people: a doctor's or clinic's contact details, the doctor of an appointment, the mother's RSV vaccination, names in notes. Enter only what you need and have the right to share, and keep it accurate. You are responsible for that information.",
        },
        {
          kind: 'p',
          text: "The Doctors and clinics list is for contact details; health information belongs in your baby's own records.",
        },
      ],
    },
    {
      id: 'legal-bases',
      title: 'Why we may use it (legal bases)',
      blocks: [
        {
          kind: 'p',
          text: 'The LGPD allows personal data to be processed only on a legal basis. These are ours:',
        },
        {
          kind: 'list',
          items: [
            'Your account, your records and sharing with the people you invite: to provide the service you asked for (LGPD art. 7, V).',
            "Health information about your baby (sensitive data): your consent for this purpose (art. 11, I). You give it when you choose to record that information in the app, to keep your child's log. You can withdraw it at any time by deleting those records or your account.",
            'Sharing with a doctor you invite: your specific consent, given when you create the doctor invite and choose the sections the doctor sees (art. 11, I). You can change the sections or end the access at any time.',
            'Optional features you turn on (reminders, the Alexa skill, the address search): your consent (art. 7, I, and art. 11, I when a reminder is about a medicine or a vaccine). You withdraw it by turning the feature off or unlinking the skill.',
            'Technical logs and protecting the service: our legitimate interest in keeping it running and safe (art. 7, IX), limited to what that needs and never using health information.',
            'When the law or an authority requires us to keep or hand over data: compliance with a legal obligation (art. 7, II, and art. 11, II, a).',
          ],
        },
        {
          kind: 'p',
          text: "Data about a child is always processed in the child's best interest (art. 14); see [Children](#privacy-children).",
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Who sees your data and who we share it with',
      blocks: [],
      subsections: [
        {
          id: 'people',
          title: 'People you share a baby with',
          blocks: [
            {
              kind: 'p',
              text: "A baby's records are seen only by the people its owner invites, with the role they get:",
            },
            {
              kind: 'list',
              items: [
                'Owner and Parent: see everything, and record and change entries. Only the Owner manages members, invites and doctor access.',
                "Caregiver: sees the baby's records and logs entries; changes only the entries they logged.",
                'Viewer: only reads.',
                "Doctor: sees only the sections the owner shares (daily log, growth, medicines, vaccines, formulas, notes), never appointments, members or your saved doctors and clinics. The owner can see in the access log when each doctor opened the baby's data, and can change or end that access at any time.",
              ],
            },
            {
              kind: 'p',
              text: 'Notes marked private are seen only by their author. Doctors in Lotties declare themselves; we do not check their registration.',
            },
          ],
        },
        {
          id: 'companies',
          title: 'Companies and services that receive data',
          blocks: [
            {
              kind: 'p',
              text: 'We do not sell personal data and do not give it to advertisers, data brokers or analytics companies. Data reaches other companies only in these cases:',
            },
            {
              kind: 'table',
              id: 'recipients',
              caption: 'Who receives data from Lotties, and when',
              columns: ['Who', 'What they receive', 'When'],
              rows: [
                {
                  id: 'pushServices',
                  cells: [
                    'Browser push services: Google (Chrome and most Android browsers), Mozilla (Firefox), Apple (Safari) and Microsoft (Edge)',
                    "Your device's push address, and the time and size of each reminder. The content is encrypted so that only your device can read it; your device writes the text you see.",
                    'Only if you turn on notifications on a device.',
                  ],
                },
                {
                  id: 'alexa',
                  cells: [
                    'Amazon (Alexa)',
                    "Amazon records and processes what you say to Alexa, under Amazon's own privacy terms. Lotties receives only the command and its values, and sends back a short answer that Alexa speaks, which can include your baby's name, feed and sleep times, diaper counts, the next appointment and vaccines that are due. Amazon also keeps the sign-in token that links the skill to your account.",
                    'Only if you enable the Lotties skill and link your account. Unlink it in the Alexa app to stop.',
                  ],
                },
                {
                  id: 'addressLookup',
                  cells: [
                    "Address search: BrasilAPI, ViaCEP and OpenStreetMap's Nominatim",
                    'Only the postal code (CEP) or the text you typed, sent by our server. Not your network address, your account, your baby or anything else.',
                    'Only when you press Find address while adding a doctor or clinic.',
                  ],
                },
                {
                  id: 'userLinks',
                  cells: [
                    'Apps and sites you open from Lotties: Google Maps, WhatsApp, and your phone, email and calendar apps',
                    'What you choose to send: the address you open in a map, the number you call or message, an appointment you add to your calendar, an invite link or a file you share.',
                    'Only when you tap such a link or share something yourself. Their own terms apply.',
                  ],
                },
                {
                  id: 'appStores',
                  cells: [
                    'Apple App Store and Google Play',
                    'They handle the download of the app. Depending on your device settings, they may share aggregate statistics and crash reports with us; never your records.',
                    'Only if you install the iOS or Android app.',
                  ],
                },
                {
                  id: 'github',
                  cells: [
                    'GitHub',
                    "Nothing from the app. If you visit our source code or write to us there, GitHub's terms apply, and issues are public.",
                    'Only if you visit or write.',
                  ],
                },
              ],
            },
            {
              kind: 'p',
              text: 'We may also disclose data when the law or a court order requires it.',
            },
          ],
        },
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        {
          kind: 'p',
          text: 'Lotties is made for adults: parents, other caregivers and health professionals. It is not meant to be used by children.',
        },
        {
          kind: 'p',
          text: "The app holds information about babies, recorded by their parents or legal guardians and by the people they invite. Under the LGPD (art. 14) we process it in the child's best interest and only to run the app for the family: never for advertising, and never to make decisions about the child or the family.",
        },
        {
          kind: 'p',
          text: "Add a baby only if you are the baby's parent or legal guardian, or have their permission. A parent or legal guardian can ask us to see, correct or delete the child's data (see [Your rights](#privacy-rights)).",
        },
      ],
    },
    {
      id: 'rights',
      title: 'Your rights and how to use them',
      blocks: [
        {
          kind: 'p',
          text: "Under the LGPD (art. 18) you can ask us to: confirm that we process your data and give you access to it; correct incomplete, wrong or outdated data; anonymize, block or delete data that is unnecessary, excessive or processed against the law; give you your data to take to another service; delete data processed with your consent; tell you whom we shared it with; tell you that you may refuse consent and what follows if you do; and withdraw your consent. You can also complain to Brazil's data protection authority, the [ANPD](https://www.gov.br/anpd/pt-br).",
        },
      ],
      subsections: [
        {
          id: 'in-app',
          title: 'In the app',
          blocks: [
            {
              kind: 'list',
              items: [
                'See and correct: what you record is shown in the app, and you can edit it as your role allows. Your health professional profile is in Settings.',
                'Download a copy: [Hub > Export data](/hub/export) downloads a complete, readable file of one baby (Owners and Parents), which another Lotties server can import. In [Settings > Account and data](/settings#account), Download my data saves what this device holds.',
                'Delete entries: a deleted entry disappears at once on every device. The server keeps it hidden, so that every device learns of the deletion, until the baby or your account is deleted; ask us if you need it erased sooner.',
                'Stop sharing: the owner removes members and doctors in [Hub > Members and roles](/hub/family), where anyone can also leave a baby.',
                "Withdraw consent for optional features: turn notifications off in [Settings](/settings#notifications), unlink the skill in the Alexa app, and change or end a doctor's access in [Hub > Doctor access](/hub/family#doctor-access).",
                'Delete your account: [Settings > Account and data](/settings#account) > Delete my account. Babies only you use are erased with all their records. On a baby other people keep, your access ends; your private notes, reminders and doctor profile are deleted; and what you added stays for them under the name "Former member". If you are the only owner of a baby others use, make someone else an owner first.',
                'Your sign-in account is removed together with your data when our server is set up to do it; when it is not, the app tells you, and you can ask us to remove it.',
              ],
            },
          ],
        },
        {
          id: 'ask-us',
          title: 'By contacting us',
          blocks: [
            {
              kind: 'p',
              text: "For anything else, or if you cannot sign in: {contact}. We may ask you to confirm that it is you, for example by writing from your account's email address. We answer as soon as we can, and send a complete statement of your data within 15 days, as the LGPD sets (art. 19).",
            },
          ],
        },
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep data',
      blocks: [
        {
          kind: 'list',
          items: [
            'Your records: until you delete them, the baby is erased or you delete your account.',
            'Deleted entries: kept hidden until the baby or your account is deleted (see [Your rights](#privacy-rights)).',
            'What you added to a baby other people keep: stays with that baby after you leave or delete your account, without your name.',
            'Your sign-in account: until you delete your account.',
            'Reminders: the delivery record for 14 days; snooze and dismiss choices for 7 days after the last change. A device that does not open the app for 90 days stops getting reminders, and the push address of a device that was switched off is deleted 30 days later.',
            'Doctor access log and invites: kept with the baby until it is erased.',
            'Technical logs: only as long as needed to run and protect the service.',
            'Database copies made before updates: deleted when no longer needed. Until then they still contain data deleted in the meantime.',
            'On your device: until you sign out (the app then deletes its copy) or clear the app data.',
            'Files you export: wherever you keep them. We cannot delete them for you.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: 'How we protect your data',
      blocks: [
        {
          kind: 'list',
          items: [
            'Every connection to lotties.app is encrypted (HTTPS); plain HTTP is redirected.',
            'Sign-in happens on our own sign-in server (Keycloak); the app never sees your password. Access uses tokens that expire, which the server checks on every request.',
            'On every request the server checks your role on that baby and, for a doctor, the sections shared. Private notes are filtered out in the database itself for everyone but their author.',
            'Invite links and the codes inside reminders are stored only as one-way fingerprints (hashes).',
            'The app runs only its own code: no third-party scripts, fonts or trackers, enforced by a strict Content Security Policy.',
            "Limits on the number and size of requests; the Alexa connection checks Amazon's signature on every request.",
            "The server uses a database account with limited rights and keeps passwords and keys out of the source code. The app's own logs leave out what you write.",
            'Administrator access to the servers is limited to the maintainer. We look at stored data only when needed to run the service, solve a problem you reported or comply with the law.',
          ],
        },
        {
          kind: 'p',
          text: 'No system is completely secure. Data on your device and the files you export are not encrypted by the app, so protect your device, sign out on shared devices and keep exported files safe. If a security incident may bring you relevant risk or harm, we will tell you and the ANPD (LGPD art. 48).',
        },
      ],
    },
    {
      id: 'transfers',
      title: 'International transfers',
      blocks: [
        {
          kind: 'p',
          text: 'Our servers are run by the maintainer in a home lab (see [Who is responsible](#privacy-controller)). Personal data goes to other countries only through optional features you choose:',
        },
        {
          kind: 'list',
          items: [
            "Notifications: the push services of Google, Mozilla, Apple and Microsoft, which operate worldwide, including in the United States. They cannot read the reminders' content.",
            'Alexa: Amazon, which processes voice requests in its own data centers, including in the United States.',
            "Address search: OpenStreetMap's Nominatim is run by the OpenStreetMap Foundation, based in the United Kingdom. BrasilAPI and ViaCEP may also use servers outside Brazil.",
            'The Apple and Google app stores and GitHub, when you use them, under their own terms.',
          ],
        },
        {
          kind: 'p',
          text: 'These transfers happen only to do what you asked for, when you turn the feature on (LGPD art. 33, IX). If you do not want them, do not turn those features on; the rest of the app works without them.',
        },
      ],
    },
    {
      id: 'device-storage',
      title: 'Cookies and storage on your device',
      blocks: [
        {
          kind: 'p',
          text: 'Lotties uses no advertising or tracking cookies, and the app itself sets no cookies. To work, also offline, it stores on your device:',
        },
        {
          kind: 'list',
          items: [
            "Your sign-in session (tokens from our sign-in server, with your name and email), in the browser's local storage. The sign-in server sets its own session cookies on its own address to keep you signed in.",
            "A copy of your babies' records and of the changes not yet sent, in the browser's database (one per account).",
            'Preferences and shortcuts: language, theme, the selected baby, pinned buttons, dismissed cards, recent values and estimates, and how often you open each place in the Hub (to order your shortcuts).',
            'An invite link while you sign in, for a moment (session storage).',
            "The app's own files, so that it opens offline. No records are kept in that cache.",
          ],
        },
        {
          kind: 'p',
          text: "Signing out deletes this account's records and preferences from the device; the app warns you first if some changes were not sent yet. Language and theme stay. The iOS and Android apps keep the same data in the app's own storage; uninstalling removes it.",
        },
      ],
    },
    {
      id: 'not-medical',
      title: 'Lotties is not a medical device',
      blocks: [
        {
          kind: 'p',
          text: 'Lotties is a log and reminder tool for families. It is not a medical device and does not diagnose, treat or give medical advice. Estimates, patterns and typical ranges are information, not recommendations.',
        },
        {
          kind: 'p',
          text: "Medicine doses and schedules come only from what you or a doctor entered; always follow your doctor's guidance. Reminders can be late or missing (no connection, phone settings), so do not rely on them alone. In an emergency, contact a doctor or emergency services.",
        },
      ],
    },
    {
      // A planned feature, not built (dataFlows.ts PLANNED_FLOWS, docs/design/34-community-insights.md):
      // keep the "not active yet" wording until the feature exists; the tests check it.
      id: 'community-insights',
      title: 'Community insights (optional, not active yet)',
      blocks: [
        {
          kind: 'note',
          text: "Not active yet. This feature does not exist in Lotties today: it is off for everyone, and nothing about your baby is used for it or shared with anyone. This section explains how it would work, so that you know before it exists. It would start for a baby only after the baby's Owner or a Parent turns it on.",
        },
        {
          kind: 'p',
          text: "Community insights would combine information from many babies whose families chose to take part, to give every family better estimates for their baby's age than general published tables can. It would be optional: the app works the same without it.",
        },
      ],
      subsections: [
        {
          id: 'purposes',
          title: 'What it would be for',
          blocks: [
            { kind: 'p', text: 'Group statistics, by age in weeks, for:' },
            {
              kind: 'list',
              items: [
                'How much milk to offer: typical bottle amounts per feed for babies the same age, to suggest better starting amounts.',
                "Growth: how your baby's weight, length and head size compare with those of babies the same age, next to the official growth curves.",
                'Tummy time: how much tummy time babies the same age usually get in a day.',
                "Sleep and feeding routines: typical naps, night sleep, feeds and diapers at this age, as context for your baby's own patterns.",
                "Unusual patterns: noticing when your baby's routine changes a lot from her own usual, measured against how much the routines of babies this age usually vary. It would never call a baby or a value normal or abnormal.",
                'Crying: what the families of babies the same age most often found helped, to order the suggestions of "Why is she crying?".',
                'Other estimates of the same kind, each added to the published list (see the safeguards below) before it is used.',
              ],
            },
            {
              kind: 'p',
              text: 'Like everything in Lotties, these would be information, not medical advice (see [Lotties is not a medical device](#privacy-not-medical)).',
            },
          ],
        },
        {
          id: 'consent',
          title: 'Only if you say yes',
          blocks: [
            {
              kind: 'list',
              items: [
                'It would stay off for every baby until someone turns it on, on a screen of its own that explains it in plain words. It would never be part of creating an account, accepting this policy or any other step, and the app would work the same if you say no.',
                "The choice would be made for each baby, by the baby's Owner or a Parent who confirms being the child's parent or legal guardian. Caregivers, Viewers and doctors could not turn it on. Every Owner and Parent of the baby would see whether it is on, and any of them could turn it off.",
                'We would keep a record of the choice: who said yes, for which baby, when and to which version of the text, to be able to show that the consent was given.',
                "Legal basis: the specific consent of a parent or legal guardian for this purpose, separate from any other (LGPD art. 11, I, and art. 14, §1), always in the child's best interest.",
              ],
            },
          ],
        },
        {
          id: 'data',
          title: 'What it would use, and what it would never use',
          blocks: [
            {
              kind: 'table',
              id: 'planned',
              caption: 'Planned, not collected today: what each estimate would use',
              columns: ['Estimate', 'What it would use', 'What you would see'],
              rows: [
                {
                  id: 'milk',
                  cells: [
                    'How much milk to offer',
                    'Age in weeks; the amount drunk in each bottle and whether it was formula or breast milk (never which formula); bottles per day.',
                    'Typical amounts per feed for the age, as starting shortcuts for the bottle amount.',
                  ],
                },
                {
                  id: 'growth',
                  cells: [
                    'Growth',
                    'Age in weeks at each measurement; weight, length and head size.',
                    "Where your baby's measurements sit among those of babies the same age, next to the official curves.",
                  ],
                },
                {
                  id: 'tummyTime',
                  cells: [
                    'Tummy time',
                    'Age in weeks; minutes of tummy time per day.',
                    'How much tummy time babies this age usually get.',
                  ],
                },
                {
                  id: 'routine',
                  cells: [
                    'Sleep and feeding routines',
                    'Age in weeks; per day, the number and length of naps and of night sleep, and the number of feeds and of diapers.',
                    'Typical routines at this age.',
                  ],
                },
                {
                  id: 'patterns',
                  cells: [
                    'Unusual patterns',
                    "The same daily counts and lengths, compared with the baby's own previous weeks.",
                    'A gentle note when the routine changes a lot from her own usual; never a label.',
                  ],
                },
                {
                  id: 'crying',
                  cells: [
                    'Crying',
                    'Age in weeks; how long each crying spell lasted and in which part of the day (morning, afternoon, evening or night); what the app suggested first and what you said helped.',
                    'What most often helped babies this age.',
                  ],
                },
              ],
            },
            {
              kind: 'p',
              text: "It would never use names (your baby's, yours or anyone else's), the date of birth (only the age in weeks), exact dates and times (only the part of the day), notes or any other text you write, photos (Lotties collects none), locations or addresses, your saved doctors and clinics, medicines, vaccines, symptoms or temperatures, or anything about a baby whose family did not turn it on.",
            },
          ],
        },
        {
          id: 'safeguards',
          title: 'The safeguards it would have',
          blocks: [
            {
              kind: 'list',
              items: [
                "Group numbers only: medians and ranges for each age band. No individual record will leave your family's account, and no copy of your records will be made for it.",
                'A minimum group size: a statistic will be published only when it comes from at least 20 babies of different families. Smaller groups are left out, and the app keeps using the published tables for them.',
                'A limit on the weight of each family: a family that logs a lot will count no more than any other, and extreme values will be capped, so that no single baby moves a number.',
                'Fixed statistics, not searches: the results will be a fixed set of numbers, recalculated regularly, and not answers to questions anyone can ask, so that they cannot be combined to single out one baby. Where it helps, a small amount of random noise will be added (a method called differential privacy).',
                'Calculated on our own servers (see [Who is responsible](#privacy-controller)). No other company will receive the data or the results.',
                'No selling, no advertising, no profiling of families and no decisions about your child or your family.',
                'Open: the code that calculates the statistics will be part of the open-source code, and the list of statistics, with what each one uses, will be published before it is used.',
              ],
            },
            {
              kind: 'p',
              text: 'Group statistics like these are very hard to trace back to one baby, but no method makes that impossible in every case. That is why these safeguards exist and why small groups are left out. Before the feature is switched on, the safeguards will be assessed in a data protection impact report (relatório de impacto à proteção de dados pessoais, under the LGPD).',
            },
          ],
        },
        {
          id: 'results',
          title: 'Who would see the results',
          blocks: [
            {
              kind: 'list',
              items: [
                'People using Lotties, only as comparisons inside the app, such as "babies this age usually..." next to your baby\'s own numbers. Nobody would see another family\'s records, and no other family would see yours.',
                'The results would not be given or sold to anyone outside the app.',
                'Doctors: what a doctor you invited can see stays the same (the sections you share, see [People you share a baby with](#privacy-sharing-people)). A doctor could not turn this on for your baby.',
              ],
            },
          ],
        },
        {
          id: 'withdraw',
          title: 'Turning it off, and your rights',
          blocks: [
            {
              kind: 'list',
              items: [
                "The baby's Owner or any Parent could turn it off at any time, as easily as it was turned on. From then on the baby's records are no longer used: the next calculation leaves them out.",
                "Statistics already calculated are group numbers with no link to any baby, so your baby's share cannot be picked out of them. They are replaced at the next calculation, which no longer includes your baby.",
                "Your baby's records themselves would never be shared: they stay in your account, where you can still see, export and delete them.",
                'Deleting a record, the baby or your account also takes it out of the next calculation.',
                "You keep every right listed in [Your rights](#privacy-rights), including asking us whether your baby's data was used and asking us to delete it.",
              ],
            },
          ],
        },
        {
          id: 'activation',
          title: 'Before it is switched on',
          blocks: [
            {
              kind: 'p',
              text: "Before community insights starts, we will update this section with the final details (including the minimum group size and the list of statistics), change this policy's version and date (see [Changes to this policy](#privacy-changes)) and tell you in the app. A change to this policy alone never turns it on: it starts for a baby only when the baby's Owner or a Parent says yes on its own screen.",
            },
          ],
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        {
          kind: 'p',
          text: 'This is version {version}, last updated on {lastUpdated}. When we change the policy, we update this page and its date. For significant changes we will let you know before they apply, for example with a notice in the app. Every earlier version stays public in the [source code history]({repoUrl}).',
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        { kind: 'p', text: 'Questions, requests about your data and complaints: {contact}.' },
        { kind: 'p', text: 'Data protection contact (encarregado): {dpo}.' },
        {
          kind: 'p',
          text: "If you are not satisfied with our answer, you can complain to the [ANPD](https://www.gov.br/anpd/pt-br), Brazil's data protection authority.",
        },
      ],
    },
  ],
  fallbacks: {
    controller: 'the Lotties project maintainers',
    contact:
      "the project's [public issue tracker on GitHub]({issuesUrl}) for questions (do not post personal data there) or, for anything personal, a [private report to the maintainers on GitHub]({advisoryUrl})",
    dpo: 'the contact above',
  },
};
