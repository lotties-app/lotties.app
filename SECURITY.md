# Security policy

## Reporting a vulnerability

Report privately, never in a public issue:

- E-mail **admin@lotties.app**.
- Or use GitHub private vulnerability reporting: https://github.com/lotties-app/lotties.app/security/advisories/new (available once the repository is public).

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge a report within 7 days and to tell you the outcome of triage within 30 days. Please give us reasonable time to fix before any public disclosure.

## Never include a child's data

Lotties stores health data about children. Do not put real baby names, birth dates, events, photos, tokens or API keys in a report, screenshot or log excerpt. Use synthetic data or redact it. If you came across real data while testing, stop, tell us, and do not keep or share it.

## Scope

In scope: the web app, the API, the mobile shells and the deploy kit in this repository, and the hosted service at https://lotties.app.

Out of scope: denial of service by volume, social engineering, physical attacks, findings that need a rooted or jailbroken device, and third-party services (Keycloak itself, Cloudflare, GitHub) unless our configuration is the cause.

## Supported versions

Only the latest release (the version shown on the About page and at `/api/version`) is supported. Fixes land on `main` and are deployed to the hosted service.

## Safe harbour

Good-faith research that follows this policy, avoids other people's data and stops at proof of impact will not be pursued.
