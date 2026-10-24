# Project board: Keycloak roles and API keys

How the owner turns on the project board (docs/design/36-project-board.md): the internal list of tasks, gaps, decisions,
questions, risks, notes and memories that the owner and the AI assistant keep together. It holds **no baby data** and
calls no third party. Nothing here is done by the repository or the agents: every step is in the Keycloak admin console,
in the owner's `deploy/homelab/.env` / Helm values, and in a terminal of the owner's.

## 1. What the API does

- Every route under `/api/v1/board` answers 404 until `Board__Enabled=true` is set on the API.
- A person reaches the board with her normal Lotties sign-in **and** one of three Keycloak realm roles:

  | Realm role | May |
  | --- | --- |
  | `lotties-board-reader` | read (items, topics, summary, export) |
  | `lotties-board-writer` | read, create, edit, comment, soft delete |
  | `lotties-board-admin` | all of the above, plus API keys, topics, restore deleted items, list deleted items |

  The API reads them from the access token's `realm_access.roles` claim; a higher role includes the lower ones (no
  composite roles needed). Any other realm role is ignored. A signed-in user without one of these roles gets 403 on
  every board route.
- A tool (Claude Code through the board MCP endpoint, section 8, or a script) uses a **board API key** instead: `lbk_` followed by 43
  characters, sent as `Authorization: Bearer lbk_...` or `X-Board-Key: lbk_...`. A key has the scope `read` or `write`
  (never admin), optionally a list of topics and an expiry. Only a board admin creates or revokes keys, and the secret is
  shown **once**, in the answer that creates it; the database keeps only its SHA-256 and its first 12 characters.

## 2. Create the three realm roles (once)

In the Keycloak admin console, realm **lotties.app**:

1. **Realm roles > Create role**. Role name `lotties-board-reader`, Description "Lotties project board: read". Save.
2. Again for `lotties-board-writer` ("Lotties project board: read and write") and `lotties-board-admin` ("Lotties
   project board: admin, API keys").

Names must be exactly these (lower case, dashes). Do not add them to `default-roles-lotties.app`: families must never get
them.

## 3. Make realm roles reach the access token

Keycloak's default client scope **roles** carries realm roles in `realm_access.roles`. Check it once:

1. **Client scopes > roles > Mappers > realm roles**: Mapper type "User Realm Role", **Token Claim Name**
   `realm_access.roles`, **Multivalued** On, **Add to access token** On. Save if you changed anything.
2. **Clients > (the web app's client, the value of `VITE_OIDC_CLIENT_ID`) > Client scopes**: `roles` is listed with
   Assigned type **Default**. If it is missing: **Add client scope > roles > Add > Default**.
3. Only if that client has **Full scope allowed** off (**Clients > the client > Client scopes > `<client>-dedicated` >
   Scope**): **Assign role > Filter by realm roles** and add the three board roles, else Keycloak drops them from the
   token.
4. Verify: **Clients > the client > Client scopes > Evaluate**, pick your user (after section 4), **Generated access
   token**: it contains `"realm_access": {"roles": [..., "lotties-board-admin", ...]}`.

Tokens issued before a change keep the old roles until they are refreshed: sign out and in again in the app.

## 4. Give the roles to people

**Users > (the owner) > Role mapping > Assign role > Filter by realm roles**, tick `lotties-board-admin`, **Assign**.
For anyone else, assign the reader or writer role the same way (or create a group, e.g. "Board writers", give the group
the role under **Groups > the group > Role mapping**, and add people to the group). To remove access, **Unassign** the
role; it takes effect when the person's token is refreshed (minutes).

## 5. Turn the board on

Set `Board__Enabled=true` on the API. The home lab kit does not set it yet (like `Mcp__Enabled`): add
`Board__Enabled: "true"` under `env:` in `deploy/homelab/values/api.yaml` in a commit of its own (it is not a secret),
then deploy (docs/PROCESS.md "Integrate and deploy"; the migration `ProjectBoard` must be applied first: docs/DEPLOY.md
"Applying migrations"). Docker Compose / local: `Board__Enabled=true` in the API's environment. Check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://lotties.app/api/v1/board/me    # 401 when on (no token), 404 when off
```

## 6. Create an API key for the assistant

Once the board page exists it has an "API keys" screen (create, copy the secret once, revoke). Until then, with the
REST API and an admin's access token:

1. Sign in at `https://lotties.app` with the admin account. Copy the access token: browser DevTools > Application >
   Local Storage > `https://lotties.app` > the key `oidc.user:https://auth.lotties.app/realms/lotties.app:<client id>` >
   the `access_token` value. It expires in minutes; never paste it in a chat or a file.
2. In a terminal (the token is read without echo and stays out of the shell history):

   ```bash
   read -rs TOKEN   # paste the access token, Enter
   curl -s -X POST https://lotties.app/api/v1/board/keys \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"name":"Claude Code (dev machine)","scope":"write","expiresAt":"2027-04-24T00:00:00Z"}'
   unset TOKEN
   ```

   The answer is `{"key": {"id": "...", "prefix": "lbk_AbCdEfGh", ...}, "secret": "lbk_..."}`. Store `secret` where the
   assistant reads it (a password manager, or the environment variable `LOTTIES_BOARD_KEY` of the machine that runs
   it). It is never shown again; a lost secret means a new key.
3. Use it:

   ```bash
   curl -s https://lotties.app/api/v1/board/summary -H "X-Board-Key: $LOTTIES_BOARD_KEY"
   ```

Options of the creation body: `scope` `read` or `write`; `allowedTopics` (e.g. `["process-meta","product"]`) limits the
key to those topics; `expiresAt` (in the future; leave it out for no expiry, which is not recommended).

List keys: `GET /api/v1/board/keys` (prefix, name, scope, topics, expiry, last use, use count). Revoke: `DELETE
/api/v1/board/keys/{id}` (immediate; the key then gets 401 `invalid_board_key`).

## 7. If a secret leaks

Revoke the key at once (section 6), create a new one, and look at the board history (`GET /api/v1/board/items/{id}`,
the `actor` of each entry names the key) for writes you did not expect. The `lbk_` prefix lets GitHub secret scanning and
similar tools flag a committed key (custom pattern `lbk_[A-Za-z0-9_-]{43}`).

## 8. Connect Claude Code: the board MCP endpoint

The board has its own MCP endpoint, `https://lotties.app/api/v1/board/mcp` (Streamable HTTP, stateless; design in
docs/design/36-project-board.md section 9). It is **not** the baby-data MCP server of docs/MCP.md: its own URL, its own
tools, and only board credentials (a board API key, or a Keycloak access token with a board role). A board key never
works on `/api/v1/mcp` and a baby MCP token never works here.

| Credential | Tools |
| --- | --- |
| read key, or `lotties-board-reader` | `board_summary`, `board_list_topics`, `board_list_items`, `board_get_item`, `board_search`, `board_recent_changes` |
| write key, or `lotties-board-writer` / `-admin` | the six above plus `board_create_item`, `board_update_item`, `board_set_status`, `board_add_comment`, `board_record_decision`, `board_delete_item` (soft delete) |

No tool restores items, manages topics or touches API keys (that stays with admins in the app or the REST API). Every
write goes into the item's history with the key's name (or the person's name).

### 8.1 Turn it on

Both flags are needed (either off: every board MCP route answers 404). In `deploy/homelab/values/api.yaml` under `env:`
(not secrets), in a commit of their own, then deploy as usual (docs/PROCESS.md "Integrate and deploy"; no migration, no
ingress change: the path is under `/api`):

```yaml
Board__Enabled: "true"
Board__Mcp__Enabled: "true"
```

Check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lotties.app/api/v1/board/mcp \
  -H 'Content-Type: application/json' -d '{}'      # 401 when on (no key), 404 when off
```

### 8.2 Create a key for Claude Code

As in section 6: `scope` `write` for an assistant that keeps the board, `read` for one that only reads; optionally
`allowedTopics`; always an `expiresAt`. Name it after where it runs ("Claude Code (dev machine)"): the history shows that
name on every change. Keep the secret in an environment variable of that machine, e.g. `LOTTIES_BOARD_KEY` (in your shell
profile or a password manager's CLI), never in the repository.

### 8.3 Add it to Claude Code

For you only (Claude Code's local scope, stored in `~/.claude.json` on this machine, which then holds the secret):

```bash
claude mcp add --transport http lotties-board https://lotties.app/api/v1/board/mcp --header "Authorization: Bearer lbk_..."
```

For a project (a `.mcp.json` at the repository root that can be committed, because it holds only the variable's name;
Claude Code expands `${LOTTIES_BOARD_KEY}` from the environment when it starts, and asks once to trust project servers):

```json
{
  "mcpServers": {
    "lotties-board": {
      "type": "http",
      "url": "https://lotties.app/api/v1/board/mcp",
      "headers": { "Authorization": "Bearer ${LOTTIES_BOARD_KEY}" }
    }
  }
}
```

`X-Board-Key: lbk_...` works in place of the `Authorization` header. Check with `claude mcp list` (lotties-board
connected) and, in a session, `/mcp` (the tools). Then ask, for example, "what is waiting on me on the board?" or "add a
gap to privacy-legal: ...".

A Keycloak access token works too (`Authorization: Bearer <access token>` of a user with a board role, copied as in
section 6), but only until it expires (minutes): the endpoint offers no OAuth discovery or client registration, so Claude
cannot sign in by itself. Use a key for anything that lasts.

### 8.4 Test with the MCP Inspector

On a developer machine: `npx @modelcontextprotocol/inspector`, Transport **Streamable HTTP**, URL
`https://lotties.app/api/v1/board/mcp` (or a local API, `http://localhost:5290/api/v1/board/mcp` with both flags on), and
the header `Authorization: Bearer lbk_...` (the Inspector's authentication / custom header fields; the field names
change between Inspector versions). Connect through the Inspector's proxy (no browser `Origin` reaches the API); a direct
browser connection needs `Board__Mcp__AllowedOrigins=http://localhost:6274` on a test API only. Check: `tools/list`
shows 6 tools with a read key and 12 with a write key; `board_summary` answers the totals; `board_create_item` twice with
the same `externalKey` creates one item (the second answer has `created: false`); with a read key, `board_create_item`
answers a `forbidden` tool error.

### 8.5 Limits, logs, revoking

- Every MCP message counts against `RequestLimits__BoardPermitsPerMinute` (120 per key or per user, shared with the REST
  routes); a tool call over it answers a `rate_limited` tool error with `Retry-After`. Bodies up to
  `RequestLimits__BoardMaxRequestBodyBytes` (256 KiB, else 413).
- API logs: `Board MCP <tool>: <result code> (correlation <id>)` per tool call and `Board MCP request refused: origin not
  allowed`. Arguments, titles, bodies and keys are never logged.
- Revoke the key (section 6, `DELETE /api/v1/board/keys/{id}`): the next MCP message answers 401. Remove it from Claude
  Code with `claude mcp remove lotties-board` (and the variable from the machine). To stop the endpoint for everyone:
  `Board__Mcp__Enabled=false` and deploy (the REST board keeps working).
