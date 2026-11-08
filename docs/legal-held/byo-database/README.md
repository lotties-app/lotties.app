# Held: privacy policy and consent for "bring your own database"

Status: **held, not shipped**. Nothing here is part of the app, the privacy page or the consent the app asks for.

## Why it is held

PR #63 (commit `ae6d8d30ecc0e5f9de898e026f4606f6b84a342c`, "privacy policy and consent for own database (BYO T12)")
shipped privacy policy 13 (2026-11-07) and a minor consent entry `2026-11-07.1`. The owner decided on 2026-11-08 that the
privacy change for bringing your own database ships **later, as one MATERIAL consent version, at general release** of the
feature. Until then the feature is off in production (`Stores:Enabled=false`, allowlist), so production keeps privacy
policy **12** (2026-11-06) and consent version **`2026-11-06.1`**, with no policy text about own databases.

The PR that held it restored every shipped legal file to its state before #63 (`git diff ae6d8d3^ --` on the policy,
`privacyPolicy.ts`, `policyTypes.ts`, `dataFlows.ts`, `consentVersions.json`, `ConsentVersions.cs` and
`consentVersions.test.ts` is empty) and kept the work here.

## What is here

- `privacy-policy-own-database.patch`: re-applies the #63 code changes under `code/web/src/legal/` on top of the held
  state:
  - `privacy.en.ts`, `privacy.pt-BR.ts`: the "Your own database" section (`own-database`), the data row for the sealed
    connection details, the user-chosen provider as a recipient, and the lines in legal bases, consent, rights,
    retention, security and transfers;
  - `policyTypes.ts`: the `own-database` section id;
  - `dataFlows.ts`: `OWN_DATABASE_FLOW`, the `chosenBy` field on recipients and the `ownDatabaseProvider` recipient;
    `dataFlows.test.ts`: the checks that the policy states those facts;
  - `byoDatabaseConsent.ts` (and its test): the legal text of the optional consent `byo_database`;
  - `consentVersions.test.ts`: the consent digest also covers `byoDatabaseConsent.ts`;
  - `forbiddenClaims.test.ts`: scans the own-database consent again; `forbiddenClaims.ts`: comment only;
  - `PrivacyPage.test.tsx`: the recipients table length follows `THIRD_PARTY_IDS`;
  - `privacyPolicy.ts`: version 13, date 2026-11-07 (**change both at release**, see below).
- Edits made while held (2026-11-08, owner request), already in the patch: the policy subsection "Your provider and your
  responsibility" and the consent text split who is responsible for what (the person: her database, its provider
  account, availability, backups, costs, security settings, access, the roles she creates and any copy left there;
  Lotties: not responsible for loss, unavailability, deletion or exposure caused by her database, provider or settings,
  and still responsible for its own processing, servers, database and the sealed connection details; "nothing in this
  section limits the rights the law gives you"). The account-deletion line now mentions the opt-in wipe (T10). The
  wording awaits legal review (docs/PRIVACY-LAWYER-BRIEF.md item 19): liability exclusion may be limited by law.
- The patch does **not** contain a consent version entry on purpose: the release adds a new MATERIAL entry (below).
  Right after `git apply`, exactly three tests fail, as guards until steps 3, 4 and 7 are done: the two version/digest
  checks of `consentVersions.test.ts` and the "not in the shipped policy" check of `heldLegal.test.ts` (checked
  2026-11-08: every other test in `src/legal` passes with the patch applied).
- The audit text (docs/design/33-privacy-audit.md section 17) and the lawyer question
  (docs/PRIVACY-LAWYER-BRIEF.md item 19) stayed in their files, marked as held.

What stayed shipped from #63: `code/web/src/legal/forbiddenClaims.ts` and its test (a scan of user-facing texts, not a
policy statement and not part of the consent digest). The landing page and in-app own-database guide tests use it.

## Rules while held

- Nothing under `code/` imports from `docs/legal-held/`. This folder is not compiled, not tested and not bundled; a
  test (`code/web/src/legal/heldLegal.test.ts`) fails if a source file under `code/web/src` refers to it in an import.
- No shipped text may say the privacy policy covers own databases. The user guide (docs/BYO-DATABASE.md) says the policy
  update comes with the general release.
- The setup wizard's consent step (`code/web/src/byoDatabase/ConsentStep.tsx`) shows its own short facts from the i18n
  catalog (`byoDatabase.consent.fact1..7`, fact7 is the responsibility split), not `byoDatabaseConsent.ts`. Those strings are shipped (the wizard is reachable
  only where the feature is on) and are not part of the core consent digest.

## How to release (general release of the feature)

1. Apply the patch: `git apply --3way docs/legal-held/byo-database/privacy-policy-own-database.patch`. If the policy
   changed since, resolve the conflicts by hand (the source is also in commit `ae6d8d3`:
   `git show ae6d8d3 -- code/web/src/legal`).
2. Re-check every fact in the section and in `byoDatabaseConsent.ts` against the code at that time (design 47 status:
   members, reminders and doctors for such a baby, the undo window, the cipher, what moves and what stays). Known
   mismatch found while holding: the held texts say the app shows the date the undo period ends, and docs/BYO-DATABASE.md
   section 9 says the app does not show it yet; fix whichever is wrong at release. Never claim
   what the code does not do; `forbiddenClaims.test.ts` and `dataFlows.test.ts` must pass.
3. `code/web/src/legal/privacyPolicy.ts`: `PRIVACY_POLICY_VERSION` = the next number after the shipped one (13 if the
   shipped one is still 12), `PRIVACY_POLICY_LAST_UPDATED` = the release date. If the number is not 13, update the test
   "raised the policy version with the own database" in `dataFlows.test.ts` and the "policy 13" comments.
4. Add ONE new **material** consent entry, the same in `code/web/src/legal/consentVersions.json` and
   `code/api/src/Lotties.Domain/Consents/ConsentVersions.cs`: version `<release date>.1`, terms `1` (or the current
   terms version), privacy policy = the new number, `material: true` / `Material: true`, date = release date, and the
   `textDigest` that `consentVersions.test.ts` prints when it fails. Material means every person accepts again on the
   next visit (docs/design/38-consent-and-terms.md); that is the owner's decision for this release.
5. Decide whether the wizard's consent step shows the text of `byoDatabaseConsent.ts` (the legal text in the digest)
   instead of the shorter i18n facts it shows today, and link `BYO_DATABASE_POLICY_HREF` from it.
6. Update docs/design/33-privacy-audit.md section 17 (drop the held note, set the version and consent entry),
   docs/PRIVACY-LAWYER-BRIEF.md item 19, the status note in docs/design/47-bring-your-own-database.md, and the
   sentence in docs/BYO-DATABASE.md about the policy update.
7. Delete this folder, `heldLegal.test.ts` and the `.gitattributes` line for `docs/legal-held/**/*.patch` in the same
   change.
