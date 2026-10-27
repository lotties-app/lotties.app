# MCP server: the owner's setup

Lotties can be an MCP (Model Context Protocol) server, so an AI assistant a parent chooses (Claude, or any MCP client) can
read the baby's log and, only when she allows it, log sleep, feeds and diapers by tool calls. The design (layers, tools,
scopes, security decisions) is [docs/design/32-assistants.md](design/32-assistants.md) section 9; it follows the MCP
specification revision 2026-07-28 and also serves 2025-11-25 clients. This page is the step-by-step for Keycloak (realm
`lotties.app`), the cluster, Claude and the MCP Inspector.

The server is **off by default** (every MCP route answers 404). Nothing here is a secret of the API: the API only validates
the tokens Keycloak issues to the AI clients.

Values used below (replace with yours): public host `https://lotties.app` (so the MCP URL is
`https://lotties.app/api/v1/mcp`), Keycloak issuer `https://auth.lotties.app/realms/lotties.app`.

## 1. What the parent agrees to

The child's data leaves Lotties: the assistant's provider (Anthropic for Claude, or whoever runs the client) receives the
facts the assistant asks for (times, amounts, counts, vaccine names; the baby's name only if she turned on "Say my baby's name in answers", and never appointment titles or other text people typed) and processes them under
its own terms. Lotties shows this twice: on the Keycloak consent screen (section 2.3 texts) and in Settings > Voice
assistants > AI assistants (MCP). Access is read-only unless she also grants logging. Medications are never available,
and answers are facts from the family's own log, not medical advice. She can revoke the access at any time (section 8).

## 2. Keycloak: the two client scopes

Realm `lotties.app` > **Client scopes** > **Create client scope**, twice:

| Field | `lotties.read` | `lotties.write` |
| --- | --- | --- |
| Name | `lotties.read` | `lotties.write` |
| Type | Optional | Optional |
| Protocol | OpenID Connect | OpenID Connect |
| Display on consent screen | On | On |
| Consent screen text | `${lottiesMcpReadConsent}` | `${lottiesMcpWriteConsent}` |
| Include in token scope | On | On |

Keep both **Optional** at the realm level (Client scopes > the realm's default client scopes must not list them): the web
app's client never gets them, so its tokens never carry them.

### 2.1 Audience mapper (both scopes)

Each scope > **Mappers** > **Configure a new mapper** > **Audience**: name `mcp audience`, **Included Custom Audience**
`https://lotties.app/api/v1/mcp` (the MCP URL; Keycloak's own MCP guide uses the server URL), **Add to access token** On,
**Add to ID token** Off. Set the API's `Mcp__Audience` to the same value (section 4). The API refuses any MCP token
without it, and the API's audience `lotties-api` must never be added to these scopes or to the AI clients: an AI
provider's token must not work on the REST API (startup fails if `Mcp__Audience` equals `AUTH_AUDIENCE`).

Keycloak does not support RFC 8707 resource indicators yet (the `resource` parameter MCP clients send is ignored), which is
why the audience comes from the mapper. When a later Keycloak supports them, the audience it issues is the same URL.

### 2.2 Token lifetimes

Short access tokens limit what a leaked token can do: on each AI client (section 3) > **Advanced** > **Access Token
Lifespan** 5 minutes. Claude refreshes on its own (it refreshes on a 401 and before expiry). Realm settings > **Tokens**:
**Revoke Refresh Token** On (rotation, required by OAuth 2.1 for public clients), **Refresh Token Max Reuse** 0.

### 2.3 Consent texts (en and pt-BR)

Realm settings > **Localization** > **Realm overrides**, for **English** and **Português (Brasil)**:

| Key | en | pt-BR |
| --- | --- | --- |
| `lottiesMcpReadConsent` | Read your baby's Lotties log (sleep, feeds, diapers, appointments, vaccines due). What it reads goes to the company that runs this AI assistant. Read-only. Revoke any time: your account page, Applications. | Ler o registro do seu bebê no Lotties (sono, alimentações, fraldas, consultas, vacinas pendentes). O que ele ler vai para a empresa que opera este assistente de IA. Só leitura. Revogue quando quiser: página da sua conta, Aplicativos. |
| `lottiesMcpWriteConsent` | Also log sleep, feeds and diapers for your baby in Lotties, as you. Never medications. Revoke any time: your account page, Applications. | Também registrar sono, alimentações e fraldas do seu bebê no Lotties, em seu nome. Nunca medicamentos. Revogue quando quiser: página da sua conta, Aplicativos. |

The consent screen also names the client (the assistant) and its redirect host; use clear client names (section 3).

## 3. Keycloak: the AI clients

Every AI client needs **Consent required** On (Client > Settings > Login settings), so the parent sees the screen of 2.3.
Choose one or more of these ways for clients to get a client id.

### 3.1 Pre-registered public client (recommended for Claude)

Clients > **Create client**:

1. Client type OpenID Connect, Client ID `lotties-claude`, Name `Claude (Anthropic)`.
2. Client authentication **Off** (public client), Standard flow **On**, Direct access grants **Off**, Implicit **Off**,
   Service accounts **Off**, OAuth 2.0 Device Authorization Grant **Off**.
3. Valid redirect URIs: `https://claude.ai/api/mcp/auth_callback`. Anthropic documents this as the callback of claude.ai,
   Claude Desktop, mobile and Cowork (claude.com/docs/connectors/building/authentication); it may change (a
   `https://claude.com/api/mcp/auth_callback` variant has been mentioned): check that page when Claude reports a redirect
   error. Web origins: none.
4. Advanced > **Proof Key for Code Exchange Code Challenge Method** `S256`; Access Token Lifespan 5 minutes (2.2).
5. Login settings: **Consent required** On, **Display client on screen** On.
6. Client scopes tab: add `lotties.read` as **Default**. For logging:
   - read-only for everyone (the safe default): add `lotties.write` as **Optional**. Claude asks for the scope the 401
     names (`lotties.read`), so its tokens stay read-only;
   - parents who want logging: create a second client the same way, `lotties-claude-write` (Name `Claude (Anthropic),
     can log`), with **both** scopes **Default**: its tokens always carry `lotties.write`, and its consent screen shows
     both texts. The parent picks it by entering its client id when she adds the connector (section 5).
   Remove scopes the tools do not need (`roles`, `email`, `phone`, `address`, `microprofile-jwt`) from these clients.

Claude Code (the CLI) does not use this client: it identifies itself with Anthropic's Client ID Metadata Document and a
loopback redirect `http://localhost:<any port>/callback` (section 3.3).

### 3.2 Dynamic Client Registration (other clients, optional)

MCP clients may register themselves (RFC 7591; deprecated by MCP but still common). Keycloak's endpoint is
`https://auth.lotties.app/realms/lotties.app/clients-registrations/openid-connect`, advertised in the realm's discovery
document. Clients > **Client registration** > **Anonymous access policies**:

- **Trusted Hosts**: only the hosts you accept (for Claude, the egress range Anthropic publishes, `160.79.104.0/21`,
  cannot be entered as a range: prefer 3.1 for Claude); keep "Host sending client registration request must match" On.
- **Allowed Client Scopes**: `lotties.read` only (registered clients then stay read-only; add `lotties.write` only if you
  accept logging from any registered client).
- **Consent Required**: present (forces the consent screen), **Max Clients** a small number.

Without such a policy set, leave anonymous registration off: Claude then needs 3.1.

### 3.3 Client ID Metadata Documents (Claude Code, VS Code; experimental)

Keycloak 26.6 and later support CIMD as an experimental feature: start Keycloak with `--features=cimd`, then Realm
settings > **Client Policies** > Profiles: a profile with the `client-id-metadata-document` executor (**Trusted domains**
`claude.ai` for Claude Code, **Restrict same domain** Off because its redirect is a loopback address), and a policy with
the `client-id-uri` condition (**Trusted domains** `claude.ai`) using that profile. Claude uses CIMD only when the
authorization server metadata advertises `client_id_metadata_document_supported: true` and `none` in
`token_endpoint_auth_methods_supported`; otherwise it falls back to DCR. Check your Keycloak version's release notes:
this feature is new and may change.

## 4. Turn the API on

In the cluster (deploy kit `deploy/homelab`), add to `deploy/homelab/values/api.yaml` under `env:`; none is a secret:

| Variable | Value |
| --- | --- |
| `Mcp__Enabled` | `"true"` |
| `Mcp__ResourceUrl` | `"https://lotties.app/api/v1/mcp"` (the URL parents paste; it must equal what they enter in Claude exactly) |
| `Mcp__Audience` | `"https://lotties.app/api/v1/mcp"` (the audience mapper's value, 2.1; default `lotties-mcp`) |

Optional tuning (docs/DEPLOY.md "MCP server"): `Mcp__AllowedOrigins` (browser origins, for testing only),
`Mcp__MaxRequestBodyBytes`, `RequestLimits__AssistantPermitsPerMinute` (shared with Alexa). The ingress
(`deploy/homelab/manifests/ingress.yaml`) sends `/.well-known/oauth-protected-resource` to the API; deploy as usual from
the main clone (docs/PROCESS.md "Integrate and deploy"). No migration is needed. Startup fails when `Mcp__Enabled=true`
has no `AUTH_AUTHORITY` or when `Mcp__Audience` equals `AUTH_AUDIENCE`.

Check, from any machine:

```bash
curl -i -X POST https://lotties.app/api/v1/mcp -H 'Content-Type: application/json' -d '{}'
# 401, WWW-Authenticate: Bearer resource_metadata="https://lotties.app/.well-known/oauth-protected-resource/api/v1/mcp", scope="lotties.read"
curl -s https://lotties.app/.well-known/oauth-protected-resource/api/v1/mcp
# {"resource":"https://lotties.app/api/v1/mcp","authorization_servers":["https://auth.lotties.app/realms/lotties.app"],"scopes_supported":["lotties.read","lotties.write"],...}
curl -s https://auth.lotties.app/realms/lotties.app/.well-known/openid-configuration | grep -o '"code_challenge_methods_supported":[^]]*]'
# must list S256
```

Disabled, both URLs answer 404. Keycloak must be reachable from Anthropic's egress range (a WAF in front of Keycloak can
break the flow even when the API is reachable).

## 5. Add the connector in Claude

The parent, in Claude (web, desktop or mobile): **Settings** > **Connectors** > **Add custom connector**:

1. Name `Lotties`, URL: the one shown in Lotties Settings > Voice assistants > AI assistants (MCP) (Copy URL), that is
   `https://lotties.app/api/v1/mcp`.
2. Advanced settings > OAuth Client ID: `lotties-claude` (read-only) or `lotties-claude-write` (can log). Leave the client
   secret empty (public client).
3. **Connect**: Claude opens the Lotties sign-in, then the consent screen with the texts of 2.3. Approve.
4. In a chat, enable the connector and ask, for example, "when did the baby last eat?", "summarise yesterday",
   "log a 120 ml bottle" (or "log a 4 oz bottle": `log_bottle` takes `amountMl`, or `amount` with `unit` `ml` or `oz`). Claude asks before each tool call according to her Claude settings. The tools' structured values stay metric (`amountMl`); the one-line text follows the person's unit setting (Settings > Units, docs/design/37-measurement-units.md).

A Claude Team or Enterprise organization may require an Owner to add custom connectors; the steps are the same.

Other MCP clients: give them the same URL; they discover the authorization server from the 401 (section 4) and use DCR
(3.2), CIMD (3.3) or a client id you create for them like 3.1 (with their redirect URI).

## 6. Test with the MCP Inspector

On a developer machine (never against production data you do not own):

1. Create a public client `lotties-inspector` like 3.1 with redirect URI `http://localhost:6274/oauth/callback` (the
   Inspector's default; check the URL it shows), both scopes Optional.
2. `npx @modelcontextprotocol/inspector`, Transport **Streamable HTTP**, URL `https://lotties.app/api/v1/mcp` (or your
   local API, `http://localhost:5290/api/v1/mcp` with `Mcp__Enabled=true`), OAuth: client id `lotties-inspector`, scope
   `lotties.read` (add `lotties.write` to test logging).
3. Connect via the Inspector's proxy (no browser `Origin` reaches the API). For a direct browser connection set
   `Mcp__AllowedOrigins=http://localhost:6274` on a test API only.
4. Check: `tools/list` shows 19 read tools (25 with `lotties.write`, the extra ones log and `request_delete_last_entry`, which only asks: the person approves in the app); `list_babies`; `get_day_summary` without arguments;
   `log_diaper {"kind":"wet","idempotencyKey":"test-0001"}` twice logs one diaper; with a read-only token, calling a log
   tool answers HTTP 403 `insufficient_scope`.

## 7. Monitoring

API logs: `MCP <tool>: <result code> (correlation <id>)` per tool call, and `MCP request refused: <reason>` for origin,
size and scope refusals. Arguments, tokens and results are never logged.

## 8. Revoke

- **The parent**: Lotties Settings > Voice assistants > AI assistants (MCP) > **Manage connected apps** opens the Keycloak
  account console (`https://auth.lotties.app/realms/lotties.app/account/applications`): **Applications** > the
  assistant > **Remove access**. Its refresh tokens stop working; its current access token expires within its lifespan
  (5 minutes). She can also remove the connector in Claude (Settings > Connectors).
- **The owner**: Keycloak > Users > the user > **Consents** > Revoke, or Clients > the AI client > **Sessions** > Sign
  out; to stop one assistant for everyone, disable its client. To stop MCP entirely: `Mcp__Enabled=false` and deploy.

## 9. Troubleshooting

| Symptom | Check |
| --- | --- |
| Claude: "Couldn't reach the MCP server" and Keycloak sees no traffic | the 401 of section 4 has `resource_metadata`; the metadata URL answers (ingress route for `/.well-known/oauth-protected-resource`) |
| Claude: redirect URI error on the Keycloak page | the client's Valid redirect URIs (3.1.3); Anthropic's current callback URL |
| Sign-in works, every call is 401 | the token's `aud` lacks the mapper's audience (2.1) or `Mcp__Audience` differs from it |
| Every call is 403 `insufficient_scope` | the token's `scope` has neither `lotties.*` scope: the scope is not on the client (3.1.6) or "Include in token scope" is off (2) |
| Only read tools appear | expected for a read-only client; use `lotties-claude-write` to log (3.1.6) |
| A tool answers `choose_baby` | the parent has several babies and no default: the assistant should call `list_babies` and pass `babyId`, or she picks a default in Settings > Voice assistants |
| A tool answers `not_allowed` | the parent's role (a Viewer cannot log; a Doctor's patients are not available) |

## Resolved: the well-known path reached the web app (found and fixed 2026-10-24)

**Symptom:** `/.well-known/oauth-protected-resource` answered the web app's HTML (200) while `/api/...` reached the API.

**Cause:** Traefik was right (the Ingress rule, priority 74, sends the path to `lotties-api`; a request made straight to the
Traefik service answered the API's 404 while MCP was off). But traffic from Cloudflare does not go through Traefik's path
routing: the tunnel (remote-managed in the Cloudflare dashboard, token in the cluster) lands on the **web container**, whose
nginx proxies only `/api/` to the API; every other path fell to the single-page app.

**Fix:** `code/web/nginx.conf` now also proxies `/.well-known/oauth-protected-resource` (and the path-suffixed variant) to the
API, with the same headers as `/api/`. Rule for the future: anything the API serves outside `/api/` must be proxied by that
nginx too, whatever the Ingress says.

**Check:** `curl -i https://lotties.app/.well-known/oauth-protected-resource` answers JSON from the API when the baby-data MCP
is enabled (`Mcp__Enabled=true`) and the API's 404 `application/problem+json` while it is off, never HTML.
