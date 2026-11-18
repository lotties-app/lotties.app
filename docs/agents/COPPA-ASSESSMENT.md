# COPPA Applicability Assessment for Lotties

**Date:** 2026-11-18
**Status:** Draft Assessment
**Disclaimer:** THIS DOCUMENT IS AN ASSESSMENT, NOT LEGAL ADVICE. It is intended to inform product decisions and identify areas requiring expert legal review. Consult qualified US privacy counsel before making compliance decisions.

---

## Executive Summary

**Recommendation: Seek Legal Counsel**

Lotties occupies a nuanced position under COPPA (Children's Online Privacy Protection Act, 16 CFR Part 312). The app is not "directed at children" in the traditional sense -- it is a parent-facing tool where only adults create accounts and interact with the service. However, it collects extensive personal information *about* children under 13, including health data, which creates significant regulatory risk.

The FTC has not issued definitive guidance on parent-facing apps that collect children's data but do not allow child users. While several comparable apps (Baby Tracker, Huckleberry, Baby Connect) operate without COPPA compliance mechanisms, the regulatory landscape is evolving, and Lotties' collection of sensitive health information (medications, vaccinations, growth measurements, crying patterns) elevates its risk profile beyond typical baby trackers.

**Risk Level: Medium-High**

The uncertainty around whether collecting data *about* children (versus *from* children) triggers COPPA, combined with the sensitivity of the data collected and the potential for US users despite Brazilian targeting, warrants obtaining specialized legal counsel before accepting US users or expanding Community Insights.

---

## 1. COPPA Requirements Overview

### 1.1 What Triggers COPPA Applicability

COPPA applies to operators of commercial websites and online services that either:

1. **Are directed at children under 13** and collect personal information from them; OR
2. **Have actual knowledge** they are collecting personal information from children under 13, even if the service is general-audience.

(16 CFR 312.2; 15 U.S.C. 6501-6506)

**Key definitions:**
- **"Operator"** includes anyone who operates a website or online service and collects/maintains personal information from users.
- **"Personal information"** includes first/last name, physical address, screen names, phone numbers, geolocation, photos/videos/audio containing a child's image or voice, persistent identifiers (cookies, device IDs), and information about the child or parents collected in connection with an online contact point.
- **"Collection"** means gathering information through any means, including passive tracking.

### 1.2 Key Requirements When COPPA Applies

If COPPA applies, operators must:

1. **Post a clear privacy policy** describing practices regarding children's information (312.4)
2. **Provide direct notice to parents** before collecting personal information from children (312.4(c))
3. **Obtain verifiable parental consent** before collection, use, or disclosure (312.5)
4. **Allow parents to review** their child's personal information and request deletion (312.6)
5. **Limit data collection** to what is reasonably necessary for participation (312.7)
6. **Maintain reasonable security procedures** (312.8)
7. **Retain data only as long as reasonably necessary** and delete securely (312.8)

Verifiable parental consent methods include signed forms, credit card transactions, video calls, government ID verification, and other FTC-approved mechanisms (312.5(b)).

### 1.3 Parent-Facing Services Collecting Children's Data

The FTC's 2019 Statement on COPPA Enforcement acknowledged ambiguity around services where parents, not children, provide information about children:

> "When a service is directed to parents rather than children, and parents provide information about their children, COPPA may not apply. However, if the service is actually directed to children, or if the operator has actual knowledge it is collecting information from children, COPPA requirements apply regardless of who provides the information."

The FTC has taken enforcement actions against services that claimed to be parent-facing but had features attractive to children, used child-directed content, or failed to implement adequate age screening.

**Relevant precedents:**
- **Mattel (2020):** $5M settlement for failing to obtain verifiable parental consent on sites clearly directed at children.
- **Google/YouTube (2019):** $170M settlement for treating YouTube Kids as general-audience despite child-directed content.
- **Epic Games (2022):** $275M penalty partly for default settings allowing children to share personal information.

No major enforcement action has specifically targeted a parent-only baby tracker app, but this absence does not guarantee immunity.

---

## 2. Lotties Assessment Against COPPA Triggers

### 2.1 Is Lotties "Directed at Children"?

**Analysis: Likely No, but with caveats.**

Factors supporting "not directed at children":
- **Target audience:** Explicitly parents/guardians. SPEC.md states "Parents log baby events."
- **Account creation:** Requires adult authentication via OIDC (Keycloak/Auth0). No child can create an account.
- **Consent gate:** Every user must declare they are "the child's parent or legal guardian" or "an adult they authorised" before accessing any baby data (docs/design/38-consent-and-terms.md section 2).
- **Content and design:** Functional logging interface, no games, cartoons, child-oriented language, or entertainment content. MUI component library with professional styling.
- **Advertising:** None. No ads, analytics, or tracking (privacy audit section 3: "Analytics, telemetry, ads, crash SDKs, third-party fonts and CDNs: none").
- **Marketing:** Targeted at Brazilian families seeking free alternatives to paid trackers.

Factors creating residual risk:
- **Subject matter:** Babies and young children are inherently associated with children under 13.
- **Visual elements:** If the UI uses pastel colors, baby imagery, or playful icons, regulators might view it as having child appeal (requires visual inspection of deployed app).
- **Voice assistants:** Alexa skill could theoretically be invoked by children in the household, though responses are gated by account linking and carry no baby names by default.
- **Age of babies tracked:** Newborns to toddlers are definitively under 13.

**Conclusion:** Lotties is structurally designed as a parent tool, not a child-directed service. The consent declaration and adult-only authentication are strong mitigating factors. However, the subject matter alone keeps this question open to regulatory interpretation.

### 2.2 Does Lotties Have "Actual Knowledge" of Collecting Children's Data?

**Analysis: Yes, unambiguously -- but the question is whether this matters.**

Lotties knows with certainty that every baby record pertains to a child under 13:
- Birth dates are required fields (stored as week-of-birth for privacy, but still child-specific).
- Vaccine schedules are calibrated to infant/toddler ages.
- Age norms cover developmental stages from birth through early childhood.
- The entire domain model centers on babies and young children.

**However**, COPPA's "actual knowledge" prong refers to knowing one is collecting personal information *from* children, not *about* them. The distinction is critical:

- Parents enter all data themselves.
- Children never interact with the service directly.
- The consent mechanism explicitly identifies the user as a guardian.
- Account deletion and export are controlled by the adult account holder.

The FTC has not definitively ruled on whether "actual knowledge" extends to information provided *by parents about children* in a parent-only service. Some commentators argue it does when the service's sole purpose is tracking children; others argue the statutory language requires collection *from* the child.

**Conclusion:** Lotties unquestionably collects personal information about children. Whether this constitutes "actual knowledge" under COPPA is legally uncertain and requires counsel.

### 2.3 Personal Information Collected About Children

Even if COPPA does not technically apply, understanding the data sensitivity informs risk:

| Category | Examples | Sensitivity |
|----------|----------|-------------|
| Identifiers | Baby name (optional), birth week | Low-Medium |
| Health - Routine | Feeding times/amounts, sleep patterns, diaper changes | Medium |
| Health - Medical | Medications, doses, prescriptions, vaccination records | High |
| Health - Symptoms | Crying patterns, belly pain intensity, temperature readings, symptoms | High |
| Growth | Weight, length, head circumference measurements | Medium |
| Behavioral | Cry monitor audio analysis results (on-device only, spells saved) | Medium-High |
| Care context | Doctor visits, appointments, care provider directory | Medium |
| Predictions | Computed next-sleep/feed estimates based on patterns | Low (derived) |

The collection of medication data, vaccination records, symptom logs, and crying pattern analysis places Lotties in a higher sensitivity tier than basic feeding/sleep trackers.

### 2.4 Community Insights Feature

**Current status:** Not built (privacy audit row 86: "not built"). Consent infrastructure exists (opt-in, guardian confirmation required, versioned text), but no data pooling, computation, or publication occurs.

**If implemented, COPPA implications would increase significantly:**
- Aggregated statistics derived from children's health data could constitute "disclosure" under COPPA if re-identifiable.
- Even anonymized pooling requires careful analysis under both COPPA and LGPD art. 14 (children's data processing).
- Opt-in consent from guardians helps but may not satisfy COPPA's verifiable parental consent standard if COPPA applies.
- Cross-family data aggregation introduces new risks of inference attacks and re-identification.

**Recommendation:** Do not launch Community Insights for US users until COPPA applicability is resolved with counsel. The feature should undergo separate legal review before implementation.

### 2.5 Doctor Access Feature

The Doctor role allows pediatricians and specialists to access shared sections of a baby's record (daily log, growth, medications, vaccines, formulas) and write notes/proposals.

**COPPA considerations:**
- Doctors are verified professionals (though self-declared, not app-verified in v1).
- Access is scoped by Owner consent per section.
- Doctor access is logged hourly for transparency.
- This resembles a healthcare provider relationship, which may fall under HIPAA rather than COPPA in the US context.

**Risk:** If a US doctor accesses a US baby's record, the interaction could implicate both COPPA (child data) and HIPAA (protected health information). The current architecture does not distinguish US vs. non-US doctors or patients.

**Recommendation:** Geo-restrict or disable Doctor access for US-based users until healthcare regulatory implications are assessed.

---

## 3. Comparison With Similar Apps

| App | Target Market | COPPA Compliance Stated? | Notes |
|-----|--------------|-------------------------|-------|
| **Baby Tracker** (Napper) | Global | No explicit COPPA statement found | Parent-facing, similar feature set. Reference app for Lotties. |
| **Huckleberry** | US-primary | Privacy policy mentions children's data but no COPPA-specific mechanisms | Sleep tracking focus. Uses "parental consent" language without verifiable consent flow. |
| **Baby Connect** | US/EU | Claims COPPA compliance in privacy policy | Offers data sharing between caregivers. No visible verifiable consent mechanism. |
| **Glow Baby** | US-primary | States not directed at children | Tracking + community features. |
| **Sprout Baby** | US | No COPPA mention | Basic tracker. |
| **Lotties** | Brazil-primary | LGPD-focused, no COPPA assessment yet | More comprehensive health data than most competitors. |

**Observation:** The baby tracker category appears to operate in a gray zone. Most apps do not implement COPPA's verifiable parental consent mechanisms, suggesting either (a) industry consensus that COPPA does not apply to parent-only tools, or (b) widespread non-compliance that has not yet been tested by enforcement. Neither interpretation guarantees safety.

Lotties' collection of medication, vaccination, and symptom data exceeds what most competitors collect, potentially distinguishing it in a regulatory review.

---

## 4. LGPD Interaction

Lotties is primarily designed for LGPD compliance (Brazilian General Data Protection Law):

- **Art. 14:** Processing of children's and adolescents' data requires specific, highlighted consent from at least one parent or legal guardian. Lotties implements this via the core consent gate with guardian capacity declaration.
- **Art. 11:** Sensitive personal data (health) requires explicit consent or other specific bases. Health data processing is covered by the core consent.
- **Art. 5, XVIII:** Definition of children's data aligns with ECA (Statute of the Child and Adolescent): persons under 12.

**LGPD-COPPA overlap:**
- Both require parental/guardian consent for children's data.
- LGPD's "specific and highlighted" consent for children's health data is arguably stricter than COPPA's verifiable parental consent in some respects.
- LGPD applies based on processing location (Brazil) or offering services to individuals in Brazil, regardless of operator location.
- COPPA applies based on the operator's nexus to the US or collection from US children.

**Practical implication:** If Lotties accepts US users, it may need to satisfy BOTH regimes simultaneously. The existing LGPD consent infrastructure provides a foundation but may not meet COPPA's specific verifiable consent methods (credit card, government ID, etc.).

---

## 5. Risk Assessment

| Factor | Rating | Justification |
|--------|--------|---------------|
| Directed at children | Low | Parent-only auth, consent declaration, no child-facing content |
| Actual knowledge of child data collection | Uncertain | Collects ABOUT children, not FROM them; legal ambiguity |
| Data sensitivity | High | Medications, vaccines, symptoms, growth, crying patterns |
| US user exposure | Medium | No geo-blocking; Cloudflare proxy routes globally; English locale supported |
| Community Insights risk | High (if launched) | Cross-family aggregation of children's health data |
| Doctor access risk | Medium-High | Healthcare data crossing borders, potential HIPAA intersection |
| Industry precedent | Low enforcement | No known baby tracker COPPA enforcement, but limited sample |
| Regulatory trend | Increasing scrutiny | FTC expanding COPPA scope; state laws (CCPA/CPRA) adding child protections |

**Overall Risk: Medium-High**

The combination of sensitive health data, global accessibility, and legal uncertainty around parent-provided child data creates meaningful enforcement risk, particularly if the app gains US traction or launches Community Insights.

---

## 6. Recommended Actions

### If COPPA Does NOT Apply (Legal Counsel Confirms)

1. **Document the determination** with counsel's written opinion for regulatory defense.
2. **Maintain current LGPD consent infrastructure** as best practice.
3. **Add US-specific privacy disclosures** noting that the service is not directed at children and is operated from Brazil.
4. **Monitor FTC guidance** for changes in parent-facing service interpretation.
5. **Proceed with Community Insights** only after separate legal review confirming anonymization standards and cross-border transfer adequacy.

### If COPPA DOES Apply (or Cannot Be Ruled Out)

1. **Implement verifiable parental consent** using FTC-approved methods:
   - Credit/debit card verification ($0.50-$1.00 charge refunded)
   - Government ID upload with automated verification
   - Video conference with trained personnel
   - Signed consent form returned electronically
2. **Create a COPPA-specific privacy notice** separate from the LGPD policy, describing:
   - What information is collected about children
   - How it is used and disclosed
   - Parent rights to review/delete
   - Contact information for COPPA inquiries
3. **Enable parental review and deletion** beyond current export/delete:
   - Allow parents to see exactly what data exists about each child
   - Provide granular deletion options per child
4. **Limit data retention** with explicit policies:
   - Define maximum retention periods per data category
   - Implement automated purging of data beyond retention windows
   - Document retention rationale per COPPA 312.8
5. **Geo-restrict or segment US users** until full compliance is implemented:
   - Option A: Block US IP addresses at registration
   - Option B: Route US users through a COPPA-compliant flow
   - Option C: Disable US account creation pending compliance
6. **Delay Community Insights** for US users indefinitely or until compliant aggregation framework is validated.
7. **Restrict Doctor access** for US-based doctors/patients until HIPAA assessment complete.

### Regardless of COPPA Applicability

1. **Add geographic detection** to understand actual US user volume (analytics-free: server-side IP-to-country lookup at registration, stored as country code only, no PII).
2. **Review voice assistant flows** to ensure children cannot inadvertently invoke skills without account-linked authentication.
3. **Audit third-party transfers** (Cloudflare, push services, Alexa) for COPPA-safe harbor or binding corporate rules if US users are accepted.
4. **Update privacy policy** to explicitly address children's data handling in English, regardless of COPPA applicability.

---

## 7. Open Questions Requiring Legal Counsel

1. **Does collecting personal information ABOUT children (provided by parents) trigger COPPA's "actual knowledge" prong when the service is exclusively parent-facing?** This is the central unresolved question.

2. **Does the existing LGPD guardian consent declaration satisfy COPPA's "verifiable parental consent" standard, or are additional verification steps required?** The current flow relies on self-declaration without independent verification.

3. **If COPPA applies, what retention periods are "reasonably necessary" for baby health tracking data?** The current system retains data until manual deletion or account erasure with no automated purge.

4. **Does the Doctor access feature create HIPAA obligations for US patients/doctors, and how does this interact with COPPA?** The feature enables healthcare professionals to access and write clinical notes.

5. **Can Community Insights' anonymized aggregation proceed under COPPA if individual-level data was collected with proper consent, or does the aggregation itself require separate compliance?** Re-identification risk analysis needed.

6. **What is the appropriate geographic scope restriction?** Full US block, COPPA-compliant US flow, or case-by-case assessment based on user volume?

7. **Do state-level child privacy laws (California Age-Appropriate Design Code, Connecticut SB 1103, etc.) impose additional requirements beyond federal COPPA?** These laws may apply regardless of COPPA applicability.

8. **How should the bring-your-own-database feature be handled for US users?** Data stored in user-selected databases may complicate COPPA compliance verification and parental access rights.

---

## 8. Assumptions

This assessment relies on the following assumptions, verified against project documentation:

1. Only authenticated adults (via OIDC) can create accounts and access baby data. (Verified: SPEC.md, consent gate design)
2. All users must declare guardian/authorized-adult capacity before accessing any baby data. (Verified: docs/design/38-consent-and-terms.md)
3. Children cannot directly interact with the service. (Verified: no child-facing UI, auth required)
4. Community Insights is not currently operational. (Verified: privacy audit row 86)
5. No advertising, analytics, or third-party tracking exists. (Verified: privacy audit section 3)
6. The primary target market is Brazilian families. (Verified: pt-BR primary locale, ANVISA integration, BrasilAPI/ViaCEP address lookup)
7. Voice assistant responses carry no baby names or medicine names by default. (Verified: privacy audit rows 75, 84)
8. Cry monitor audio is processed on-device only; only detected spells are stored. (Verified: privacy audit row 21)

---

## References

- Children's Online Privacy Protection Act, 15 U.S.C. 6501-6506
- COPPA Rule, 16 CFR Part 312
- FTC Statement on COPPA Enforcement (2019)
- FTC Business Guidance: Complying with COPPA (updated 2023)
- LGPD Lei 13.709/2018, Arts. 5, 11, 14
- Lotties Privacy Audit: docs/design/33-privacy-audit.md
- Lotties Consent Design: docs/design/38-consent-and-terms.md
- Lotties Community Insights Design: docs/design/34-community-insights.md
- Lotties Doctor Access Design: docs/design/16-doctor-access.md, docs/design/19-doctor-dashboard.md
- Lotties SPEC: docs/SPEC.md

---

*Prepared as part of regulatory compliance assessment. Not legal advice. Review by qualified US privacy counsel recommended before acting on findings.*