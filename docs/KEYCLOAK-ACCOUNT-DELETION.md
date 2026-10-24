# Keycloak account deletion

How the owner sets up Keycloak so that deleting a Lotties account in the app also deletes the sign-in account
(Apple 5.1.1(v), Google Play account deletion, the privacy policy "Your rights"). Gap G5 of
docs/design/33-privacy-audit.md. Nothing here is done by the repository or the agents: every step is in the Keycloak
admin console and in the owner's `deploy/homelab/.env`.

## 1. What the API does

`DELETE /api/v1/me` always erases the Lotties data first (one database transaction, `EfAccountDataEraser`). Only then,
when `AUTH_ADMIN_CLIENT_ID` and `AUTH_ADMIN_CLIENT_SECRET` are both set, and the user's token issuer is exactly
`AUTH_AUTHORITY` (`https://auth.lotties.app/realms/lotties.app`), the API (`Api/Authentication/KeycloakAccountRemover.cs`):

1. asks for a token with the client credentials grant:
   `POST https://auth.lotties.app/realms/lotties.app/protocol/openid-connect/token`
   (`grant_type=client_credentials`, the client id and secret);
2. deletes the user with the admin REST API:
   `DELETE https://auth.lotties.app/admin/realms/lotties.app/users/{sub}` (`sub` of the Lotties token, which in
   Keycloak is the user id; Lotties never changes the `sub` mapper). A 404 counts as removed (already gone).

Each call has a 10 second timeout. The answer of `DELETE /me` says what happened, and the app shows it:

| `identity` (`identityRemoved`) | When | The user sees |
| --- | --- | --- |
| `removed` (`true`) | Keycloak deleted the user | "Account deleted", no warning |
| `not_configured` (`false`) | the two settings are not set (or the token came from another issuer) | the data was erased; the sign-in account still exists and the administrator removes it on request |
| `failed` (`false`) | Keycloak was down, refused (wrong role, wrong secret) or answered without a token | the data was erased; deleting the sign-in account failed; sign in later and delete again, or ask the administrator |

Before the confirmation, `GET /api/v1/me/deletion-preview` returns `identityRemovable` (true only with both settings),
and the dialog says either "Your sign-in account ... is deleted too" or "This server does not delete your sign-in
account ...". The API refuses to start when only one of the two settings is set, and `deploy.sh` refuses to deploy
then.

## 2. Create the client (once)

In the Keycloak admin console, realm **lotties.app**:

1. **Clients > Create client**. Client type **OpenID Connect**, Client ID `lotties-account-deletion`, Name
   "Lotties account deletion". Next.
2. Capability config: **Client authentication: On** (a confidential client), **Authorization: Off**. Authentication
   flow: tick only **Service accounts roles**; untick Standard flow, Direct access grants, Implicit flow, OAuth 2.0
   Device Authorization Grant and OIDC CIBA Grant. Next.
3. Login settings: leave every URL empty (the client never signs anyone in). Save.
4. Tab **Service accounts roles > Assign role**. Switch the filter to **Filter by clients**, search `realm-management`
   and assign **only** `manage-users`. Keycloak has no narrower role: the admin endpoint that deletes a user checks
   `auth.users().requireManage(user)`, which `manage-users` grants (`realm-management` roles are `view-users`,
   `query-users`, `manage-users` and the realm/client/event ones; none is delete-only). Do **not** assign `realm-admin`,
   `manage-realm` or `manage-clients`. The default `default-roles-lotties.app` role of the service account user is
   harmless; you may remove it.
5. Tab **Credentials**: Client Authenticator **Client Id and Secret**. Copy the **Client secret**.

What the secret allows: create, edit and delete any user **of the realm lotties.app** (that is what `manage-users`
means), nothing in other realms. If other applications share this realm (docs/PRIVACY-OWNER-CHECKLIST.md C5), their
users are in reach too: keep the secret only in the Kubernetes Secret.

Optional hardening: tab **Client scopes > lotties-account-deletion-dedicated > Scope**, turn **Full scope allowed** off
and add the scope mapping `realm-management` > `manage-users`, so its tokens carry nothing else.

## 3. Where the secret goes

- Home lab: in `deploy/homelab/.env` (gitignored, never committed), next to the database and push secrets:

  ```
  AUTH_ADMIN_CLIENT_ID=lotties-account-deletion
  AUTH_ADMIN_CLIENT_SECRET=<the client secret>
  ```

  `deploy.sh` writes both into the Secret `lotties-secrets` (from files, never on a command line, never printed) and
  `deploy/homelab/values/api.yaml` passes them to the API pod as environment variables. `DRY_RUN=1
  ./deploy/homelab/deploy.sh` prints `account deletion: also deletes the Keycloak user` when both are set. A changed
  Secret restarts the API pods (the checksum annotation).
- Docker Compose / local: the same two names in the root `.env` (read by the API through `EnvironmentAliases`).

## 4. Test with a throwaway user

1. Deploy (docs/PROCESS.md "Integrate and deploy"). Check the plan line above.
2. In Keycloak, **Users > Add user** in lotties.app: username `delete-test-<date>`, email verified, then
   **Credentials > Set password** (Temporary off). Or register one on the sign-in page.
3. Sign in at `https://lotties.app` with it, create a baby (optional), open **Settings > Account and data > Delete my
   account...**. The dialog must say "Your sign-in account at our sign-in server (name, email and password) is deleted
   too." Confirm.
4. The app shows "Account deleted" with no warning. In Keycloak, **Users**: the test user is gone. The API log has
   `Account of user <id> deleted; sign-in account: Removed`.
5. Optional, the credentials alone (from WSL; reads the secret from a file so it stays out of the shell history):

   ```bash
   curl -s -d grant_type=client_credentials -d client_id=lotties-account-deletion \
     --data-urlencode "client_secret@$HOME/.lotties-admin-secret" \
     https://auth.lotties.app/realms/lotties.app/protocol/openid-connect/token | jq -r .access_token | cut -c1-20
   ```

   A token prefix means the client works; `unauthorized_client` means the service account is off, `invalid_client` a
   wrong secret. Delete the file afterwards.

If step 4 shows the "failed" warning instead: the log line `Keycloak refused to delete the user <id>: HTTP 403` means
the `manage-users` role is missing; `HTTP 401` or a token error means a wrong id or secret.

## 5. When it fails, and the retry path

- `failed`: the Lotties data is already erased; the API logs a warning with the Keycloak user id (`Removing the Keycloak
  user {id} failed` or `Keycloak refused to delete the user {id}`). Either the user signs in again (Keycloak provisions
  a new, empty Lotties account) and deletes the account once more, which asks Keycloak again; or the owner deletes that
  user in **Users** (search by the id) after a request through the privacy contact.
- `not_configured`: nothing is logged with the identity; the owner removes the user found by the email the person gives
  in the request (**Users > search > Delete**).
- There is no automatic retry queue: a failure is rare (Keycloak runs in the same cluster) and each one is visible to
  the user and in the log.

## 6. Rotate the secret

1. **Clients > lotties-account-deletion > Credentials > Regenerate**. From this moment the deployed secret is invalid:
   deletions until the next step erase the data and report `failed`.
2. Put the new value in `deploy/homelab/.env` and run `./deploy/homelab/deploy.sh` (the Secret changes, the API pods
   restart).
3. Test with a throwaway user (section 4).

For no window at all: create a second client the same way, deploy its credentials, then delete the old client.

To turn the feature off: set both values to empty in `deploy/homelab/.env` (an empty value removes the key from the
Secret), deploy, then delete the client in Keycloak. The app then says before and after the deletion that the sign-in
account stays.
