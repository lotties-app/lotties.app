# 43. Funding: cover the running costs, early access for supporters

Status: decision direction agreed with the owner on 2026-11-01, nothing built. **Not legal, tax or financial advice**:
fees and rules below came from web searches that day, several are *unverified* (section 8); check the official page
before relying on one. Revenue figures are assumptions, not data.

## 1. Goal and rules

- First goal: **pay the running costs** of the app (home lab). Later, if there is surplus, a small budget to make the
  project more productive (tools, devices for testing, time).
- **No pro tiers. Everybody can do everything.** SPEC.md keeps "pro/paid tiers" as a non-goal; this plan does not change
  it. Nothing in the app is locked behind payment.
- The only difference for supporters: they get new features **first** (beta channel) and their requests are heard first.
  Everyone else receives the same feature a few weeks later.
- Fixed project constraints: AGPL-3.0, no ads, no tracking, a baby's data is never sold or used for advertising, not a
  medical device.

## 2. What it costs (owner's numbers, 2026-11-01)

| Item | R$ per month |
| --- | --- |
| Electricity for the server | 150 |
| Internet (unstable, shared with the house, so only part is really the app's) | 150 |
| Domain (R$100 a year) | ~8 |
| Apple Developer (US$99 a year, exchange rate is my estimate) | ~45 |
| Google Play (US$25 once) | ~0 |
| **Total** | **~350** (about 200 if the internet is not counted) |

How many supporters cover it (assumption: payment platform and cancellations eat about 10-15%):

| Monthly contribution | Supporters for R$350 | Supporters for R$200 |
| --- | --- | --- |
| R$10 | ~40 | ~23 |
| R$15 | ~27 | ~15 |
| R$25 | ~16 | ~9 |

Aim for 40 to 50 people at R$10 to cover the full cost with a margin. A budget for "more productive" needs more than that.

## 3. Early access for supporters (the only difference)

- A feature is built and tested, then goes to a **beta channel** first: the iOS TestFlight group (already used by
  the mobile release workflow), and a beta build of the web app. Supporters are invited. Two to four weeks later, the same
  build goes to everybody. Nobody is excluded from anything, only delayed.
- **Request board**: anyone can ask for a feature (the project board or GitHub issues once public). Supporters can vote and
  see what is in progress. The owner decides what is built.
- Manual at first: the owner keeps the supporter list outside the app and invites people to TestFlight and the beta
  address. No entitlement table, no webhook, no check inside the app. If it grows, a supporter flag could come later, and
  it must then follow the rules in section 6.
- Limit: with a public AGPL repository the source is visible to everybody. "First" applies to the built and distributed
  app, not to the code.
- The supporter list holds names and e-mails: keep it out of the repository, and share it with nobody who does not need it.

## 4. Where the money comes in (outside the app)

The payment happens on someone else's page, the app only links to it, so there is **no new data flow in the app**.

| Channel | Notes |
| --- | --- |
| Pix (fixed key or QR on a support page) | No platform cut. Needs a way to know who paid and a decision on how to receive (section 7). |
| Pix Automático via a Brazilian provider (Mercado Pago, Asaas, Pagar.me, Stripe Brazil) | Recurring, mandatory for banks since January 2026. Fees not retrieved: compare the pricing pages. |
| Apoia.se / Catarse | Brazilian recurring support, fees not priced here. |
| GitHub Sponsors | Official docs: no fee from personal accounts, up to 6% from organizations; check Brazil availability. Needs a public repo. |
| Open Collective / Open Source Collective | Fiscal host that handles the legal entity; fee figures conflict (5% or 10%), *unverified*. |

Where the link lives: README, `/credits`, the landing page footer, a short note in Settings. Never on a baby screen, never
a prompt after logging something.
Built (2026-11-03): the landing footer and Hub > About show "Support the developer" when the web build sets
`VITE_SUPPORT_URL` (http/https only, opens in a new tab, hidden when empty; docs/DEPLOY.md "Footer links").

## 5. Other sources (secondary)

- **Grants (editais)** are one-off money for a project, mostly for development time, not for monthly bills. They need weeks
  of writing, results are uncertain, and they fit better after the repo is public and has users. Candidate: NLnet (grants
  of about €5,000 to €50,000, fit as privacy-by-design and self-hosting; a call was listed closing 2026-11-03, check
  nlnet.nl). A Portuguese search for Brazilian calls (FAPESP, FINEP, CNPq, BNDES, university and hospital calls) is still
  to do. Not part of the first plan.
- Managed hosting for families, a doctor-side subscription, a printed baby book: only if people ask for them. Doctor and
  hosting work would make the owner the data operator for other people and would reopen the "no pro tiers" rule.
- **Selling aggregated data: not now (owner decision 2026-11-01, revisit later).** Reasons: (1) legal: truly anonymized data is outside LGPD, but this is a baby's health data and re-identification is easy in small groups; it needs explicit opt-in, k-anonymity (docs/design/34), a lawyer's review, and a new privacy policy, `dataFlows.ts`, audit 33 and consent version; the lawyer question is still open. (2) Trust: privacy is the project's main promise, one headline would cost more than the income. (3) Money: buyers (formula makers, pharma, research institutes) pay only for thousands of active babies; at this size it would not cover the running costs. Alternatives: give aggregated insights back to parents for free (design 34), or a non-commercial research partnership with a university or hospital, opt-in only, which may also bring grants. Revisit with scale, a lawyer and a ready consent flow.
- Dual licence: AGPL already allows companies to use the code; no buyer today.

## 6. If a supporter flag is ever added

Today nothing here is in code. If the owner decides to automate the beta invitation, then: an entitlement table for the
user, erased with the account (`AccountErasureTests.Rules`, `EfAccountDataEraser`), never in the baby backup; a payment
provider as a new third party (privacy policy in both languages, `legal/dataFlows.ts`, audit 33, policy version, and a new
consent version if the meaning changes); the gate decides only who is invited to a beta channel, never what a person can
do in the stable app.

## 7. Items only the owner and an accountant can settle

- Receiving money as a person, MEI or company; nota fiscal and ISS if it counts as a service; whether a contribution counts
  as a donation or revenue; foreign payouts.
- Whether early access counts as a consumer subscription (CDC: cancellation and refund rules) or as a donation. Wording on
  the support page should say what supporters get and that it is not a purchase of a product.
- LGPD role for the supporter list (name, e-mail) and the wording of the page. This joins the open lawyer question.

## 8. Sources and what is unverified (searched 2026-11-01)

- Apple Small Business Program (15% under US$1M) and the Brazil framework since 2026-06: figures from secondary sources
  conflict; only relevant if payments ever happen inside the iOS app, which this plan avoids.
- Google Play fee split from 2026-06-30 (10% service fee plus a billing fee): same remark.
- GitHub Sponsors fees: docs.github.com/en/billing/concepts/third-party-payments/github-sponsors.
- Open Source Collective fees: docs.opencollective.com/help/fiscal-hosts/fiscal-host-fees (conflicting).
- Pix Automático: Mercado Pago and Asaas docs (secondary; no fee figures retrieved).
- Grants: nlnet.nl and secondary summaries.
- Costs in section 2 are the owner's numbers; the exchange rate and the platform fee margin are my assumptions.

## 9. Next steps (nothing started)

1. Decide the channel and the support page wording (owner).
2. Make the repo public when ready (needed for GitHub Sponsors, optional for Pix and Apoia.se).
3. Decide how to receive money (section 7) with an accountant.
4. Create a beta TestFlight group and a beta web address; define the 2 to 4 week delay.
5. Create the request board with supporter votes.
