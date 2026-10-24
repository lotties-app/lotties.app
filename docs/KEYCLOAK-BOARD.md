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
- A tool (Claude Code, a script, later the board MCP endpoint) uses a **board API key** instead: `lbk_` followed by 43
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
