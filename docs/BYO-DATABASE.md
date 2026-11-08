# Your own database: a user guide

Lotties normally keeps your baby's records in its own database, and that does not change unless you ask. This guide is for
the **option** of keeping one baby's care records in a Postgres database of your own instead (for example Supabase or Neon).
It is written for parents; the operator's side is in [DEPLOY.md](DEPLOY.md) ("Applying migrations to user stores" and the
sections after it), the design in [design/47-bring-your-own-database.md](design/47-bring-your-own-database.md).

> **Not available to every account yet.** The feature is off by default on the server and, when it is on, only accounts on a
> list kept by whoever runs your Lotties can use it. If you do not see **Settings > Where your data lives**, it is not
> turned on for you, and nothing in this guide applies to you.

> **Not yet tested on a real provider account.** The Supabase and Neon steps below were written from the providers' public
> pages and checked against Lotties' own automated tests with a plain Postgres, not on a real Supabase or Neon account.
> Screens, names and limits there may differ. Lines marked *(not yet tested on a real account)* are the ones most likely to.

## Contents

1. [What it is, and what it is not](#1-what-it-is-and-what-it-is-not)
2. [Who can use it](#2-who-can-use-it)
3. [What Lotties still keeps](#3-what-lotties-still-keeps)
4. [Limits of this first version](#4-limits-of-this-first-version)
5. [Set it up, step by step](#5-set-it-up-step-by-step)
6. [Supabase](#6-supabase)
7. [Neon](#7-neon)
8. [Any other Postgres](#8-any-other-postgres)
9. [Moving your records in, and back](#9-moving-your-records-in-and-back)
10. [When your database is down](#10-when-your-database-is-down)
11. [Disconnecting](#11-disconnecting)
12. [Deleting your account](#12-deleting-your-account)
13. [Troubleshooting by error code](#13-troubleshooting-by-error-code)
14. [FAQ](#14-faq)

## 1. What it is, and what it is not

**What it is.** You keep using the Lotties app and your Lotties account exactly as before: same sign-in, same screens, same
sync, same offline use. The only thing that changes is **where one baby's care records are stored**: in a Postgres database
you created and pay for (or use on a free plan), instead of Lotties' database. "Care records" means the events (feeds, sleep,
diapers...), custom event types, medicines and prescriptions, formulas, appointments, care providers, vaccinations,
measurements, notes and the related proposals and read marks.

Everything still goes **through the Lotties API**. Your phone never connects to your database; Lotties' servers do, read and
write the records for you, and compute insights, predictions, vaccine status and voice answers from them as usual.

It is a choice **per baby**, and **reversible**: you can move the records back to Lotties hosting at any time.

**What it is not.**

- **Not end-to-end encryption.** Lotties' servers read your baby's records every time you use the app, and the people who
  run Lotties could read them too.
- **Not a way to hide your connection details from Lotties.** Lotties stores them **sealed** (encrypted at rest, AES-256-GCM,
  with a key kept outside the database): someone who only has a copy or a backup of Lotties' database cannot read them.
  But the Lotties service holds that key and opens them to connect, so the operator can too. The app never shows them to
  anyone again, you included.
- **Not a backup.** Your database, its backups and its costs are yours. Some free plans keep no backups. Download a backup
  from Lotties (Hub > Export data) from time to time.

What you gain is **control over where the data lives**: which provider, which region, which account, and the ability to see,
copy or delete the rows yourself.

## 2. Who can use it

- Only the baby's **Owner**, and only when the feature is on for her account (see the note at the top).
- In this first version the baby must have **no other members**: no partner, caregiver, viewer or doctor, and no pending
  invite. While the records are in your own database nobody else can be invited (`store_owner_only`). To share the baby,
  move the records back to Lotties hosting first.
- One database per account.

## 3. What Lotties still keeps

In Lotties' own database, as today:

- your account, your consents (including the optional `byo_database` agreement you give during setup), your settings;
- the baby's profile row (the baby itself, its members and roles, invites, doctor access);
- push subscriptions and notification preferences;
- the **sealed** connection details, the provider name you typed, and the state of the connection (when it was last
  checked and a coarse result such as "ok" or "credentials rejected");
- the state of the latest move of the baby (direction, progress, a failure code).

For 7 days after a move (the undo window, see section 9) the **old copy** of the records also stays where they came from.

## 4. Limits of this first version

- **No reminders** (push notifications) for a baby whose records are in your own database.
- **Owner only**: no family members, no doctor access (section 2).
- Such a baby is left out of any anonymous statistics (none exist today).
- **Voice assistants** (Alexa, the MCP server) keep working through the same API; when your database is down they answer
  that the information is temporarily unavailable, and save nothing.
- Lotties connects only on ports **5432 and 6543**, only to a **public internet address** (never a home or private
  network), and always with **TLS and a verified certificate**.
- The maintainers' servers have **no IPv6**: an address that answers only on IPv6 cannot be reached. Use an IPv4 address
  (on Supabase, the pooler; section 6).
- Saving or moving: at most 10 times an hour; testing: at most 5 times an hour.

## 5. Set it up, step by step

Path in the app: **Settings > Where your data lives** (Owner only). The screen shows two options, "Lotties hosts it"
(current) and "My own database", the honest limits, and a link to the provider guides (`/help/own-database`).

Press **Set up my own database**. The wizard has five steps:

1. **Choose a provider**: Supabase, Neon or "Other Postgres". This only changes the guide shown and the default ports; the
   name is what you will see later ("Your database: Supabase").
2. **Prepare your database**: the app writes the setup SQL **on your device** (nothing is sent) with two role names and two
   random passwords. Copy it, run it once in your database's SQL editor as its admin user (sections 6 to 8). It creates:
   - `lotties_migrator`: owns a schema called `lotties`, and is used by Lotties to create and update the tables;
   - `lotties_app`: can only read and write the tables of that schema, and is used for everyday sync;
   - no superuser rights, no new databases or roles, a connection limit, and query timeouts.

   **Custom roles**: you can change the two role names (lower-case letters, digits and `_`, starting with a letter, two
   different names). Press **New passwords** for new random ones. The passwords exist only on that screen: type them in the
   next step. The same SQL, for `psql`, is in [sql/byo-setup.sql](sql/byo-setup.sql) (role names and passwords as psql
   variables). Never give Lotties your admin user (`postgres`): the test refuses a role that can do too much.
3. **Connection details**: host, port, database, user name and password for the **everyday connection** (`lotties_app`)
   and for the **migration connection** (`lotties_migrator`, same database). Use the direct or session-mode address for the
   migration connection: a transaction pooler breaks the table updates. Optional: a certificate authority (PEM), only if
   your server's certificate comes from a private authority.
4. **Your agreement**: the plain facts (the records go to your provider, Lotties reads and writes them, not end-to-end
   encryption, sealed details, the provider's terms apply, you can leave). Tick the box to give the optional consent
   `byo_database`.
5. **Save and test**: only now does anything leave your device. Lotties records your agreement, seals and saves the
   details, and tries them: it reaches the database with both roles, checks that the app role has only the rights it needs
   and that the database is empty or already set up for this baby. **The test moves or changes no records.** After the
   save the screen forgets the passwords.

A passing test shows **Connected**. Then **Move my records there** appears (section 9). Until you press it, the records stay
with Lotties.

## 6. Supabase

*(not yet tested on a real account)*

1. Create a project at supabase.com and pick a region close to you. A free plan existed at the time of writing, with
   limits (free projects may be paused after some days without use): check Supabase's pricing page.
2. Open the project's **SQL Editor**, paste the setup SQL from the app (step 2) and run it once.
3. Press **Connect** in the project and look at the **connection pooler** addresses.
   - **Migration connection: session pooler, port 5432.** Supabase's direct connection (`db.<project>.supabase.co`) is
     IPv6-only on the free plan according to its documentation, and the maintainers' servers have no IPv6, so use the
     session pooler, which answers on IPv4.
   - **Everyday connection: transaction pooler, port 6543** (or the session pooler on 5432 again).
   - Database: usually `postgres`.
4. On a pooler the user name is the role, a dot and your project reference, for example `lotties_app.abcdefgh` and
   `lotties_migrator.abcdefgh`. The passwords are the ones from the setup SQL.
5. Do not add the `lotties` schema to the project's exposed schemas (API settings): Lotties needs no Supabase API, and
   leaving it out keeps the records off Supabase's automatic REST API.
6. Free projects may be paused: then open the project, restore it, wait a minute and press **Test again** in Lotties.

## 7. Neon

*(not yet tested on a real account)*

1. Create a project at neon.com and pick a region close to you. A free plan existed at the time of writing, with limits
   (storage per project, compute hours): check Neon's pricing page.
2. Open the **SQL Editor**, choose the database (usually `neondb`), paste the setup SQL and run it once.
3. Open **Connect**.
   - **Everyday connection**: the pooled host (its name contains `-pooler`), port 5432.
   - **Migration connection**: turn pooling off and use the direct host, port 5432.
4. User names: `lotties_app` and `lotties_migrator` (or your custom names), with the setup SQL's passwords.
5. Neon stops an idle database and starts it again on the next request, so the first sync after a quiet time can be slow
   (a `store_timeout` that goes away on its own). Over the storage limit, saving fails (`store_quota_full`) until you free
   space or change the plan.

## 8. Any other Postgres

- A public internet address (not a home or private network, not a VPN or tailnet address), port 5432 or 6543, TLS with a
  certificate Lotties can verify. If the certificate comes from a private authority, paste that authority's certificate in
  step 3.
- Connect as the database's admin user and run the setup SQL once (the app's copy, or `psql` with
  [sql/byo-setup.sql](sql/byo-setup.sql)).
- Give the primary server, not a read replica.
- Use the direct or session-mode address for the migration connection.

## 9. Moving your records in, and back

**Moving in.** After a passing test, press **Move my records there**. The move runs on the server in the background:

1. Saving new records for the baby pauses (`store_moving`): your phone keeps the changes and sends them when the move ends.
   Reading goes on.
2. Lotties prepares the tables in your database, copies the baby's records row for row, then checks that the copy matches
   (row counts and a checksum per table). A mismatch copies again; a second mismatch fails the move.
3. Only then the baby switches to your database. Phones pull the records again from the new place.

Usually seconds to a minute. Open the screen again to see the result. If the move fails, the baby **stays where it was**
and what reached your database is deleted. Records of other people's private notes (a former member's or doctor's) are not
copied into your database; they stay with Lotties' old copy and are deleted with it.

**Moving back.** Press **Move back to Lotties hosting**. The same steps run the other way.

**The 7-day undo window.** After a move the old copy is kept where the records came from for 7 days (the operator can change
this number) and then deleted automatically. Moving the other way during that time is the undo. So after moving **in**,
Lotties' database still holds the old copy for those days: the privacy gain is complete only after the window. The app does
not show the date yet.

## 10. When your database is down

Paused free projects, a changed password, a full disk or a network problem make your database unreachable. Lotties never
writes your baby's records to its own database instead.

- The API answers `503` with a `store_*` code and a "try again after" time. **Your phone keeps every change in its outbox**
  and sends it when the database is back, like when you are offline. Nothing is lost, and other babies keep syncing.
- What you already have on the phone stays readable.
- **Settings > Where your data lives** shows what is wrong in plain words (for example "Your database is not reachable" or
  "The database refused the password") and what to do.
- **New password, a reset at your provider, or a new pooler address**: press **Update connection details** on that screen
  and type the details of the **same database** again (all of them, passwords included: Lotties never shows the saved ones).
  **Save new details and test** replaces the sealed details and tests them at once; **Test the saved details** tries the
  ones already saved (for example after you resumed a paused project). Your baby's records and where they live do not
  change; Lotties starts using the new details at once. Details that open another database are refused
  (`store_not_same_database`) and the saved ones stay (FAQ below).
- After a few failures in a row Lotties stops trying for a short while (30 seconds, doubling up to 5 minutes), so a paused
  database is not woken up again and again.
- Voice assistants answer that the information is temporarily unavailable.

## 11. Disconnecting

- **While the records are in your database**: press **Move back to Lotties hosting** first. Lotties refuses to forget a
  database that still holds a baby's records (`store_in_use`). Moving back reads the records from your database, so it
  needs a working connection: if the screen shows a problem, fix it first (resume the project, or **Update connection
  details** until the test passes), then move back.
- **While the records are with Lotties** (or after moving back): **Forget the saved details** removes the sealed connection
  details from Lotties. Your database is not touched.
- **The old copy after moving back**: Lotties deletes it after the undo window, but only if it can still reach your
  database then. If you forget the details (or change the password) before that, the copy stays in your database: delete it
  yourself, for example with `DROP SCHEMA lotties CASCADE;` and then `DROP ROLE lotties_app; DROP ROLE lotties_migrator;`
  as the admin user.
- **From your side**: changing the roles' password or dropping the roles stops Lotties at once (`store_credentials_rejected`).
  Lotties cannot move the records back until you give it working details again with **Update connection details**.

## 12. Deleting your account

Deleting your Lotties account (Settings > Account and data) always erases what Lotties holds, **including the connection
details**, so Lotties can no longer reach your database afterwards.

- If a baby deleted with your account has records in your own database, the delete dialog shows an **unticked box**: "Also
  delete these babies' records in my own database".
  - **Not ticked** (the default): your database is not touched. The records stay there, yours.
  - **Ticked**: before erasing its side, Lotties deletes those babies' rows in your database (including an old copy in its
    undo window or a failed move's leftovers). It drops no schema and no role.
- If your database cannot be reached (at most 30 seconds per database), the account is deleted anyway and the app lists the
  babies whose records are **still in your database**: delete them yourself (for example by dropping the `lotties` schema).
- While a move of one of your babies is running, the deletion waits (`store_move_in_progress`, minutes). During the
  deletion new records of those babies are refused (`store_account_deleting`).
- Anonymous statistics: account deletion does not touch aggregate numbers that are truly anonymous. None exist today.

## 13. Troubleshooting by error code

The app shows plain words, never the server's own text. The codes, for reference:

**Setup and test**

| Code | Meaning | What to do |
| --- | --- | --- |
| `endpoint_invalid_field`, `endpoint_invalid_host`, `validation_failed` | A detail is missing or malformed | Copy it again from the provider's connection page |
| `endpoint_port_not_allowed` | Port other than 5432 or 6543 | Use the provider's address on one of those ports |
| `endpoint_unresolvable` | The host name does not exist | Check for a typo |
| `endpoint_blocked_address` | A private, local or otherwise refused address | Use a database on the public internet |
| `endpoint_tls_failed`, `store_tls_failed` | The certificate could not be verified | Use the provider's address; for a private authority paste its certificate |
| `endpoint_invalid_ca` | The pasted certificate is not valid PEM | Paste the whole block with the BEGIN and END lines |
| `store_credentials_rejected` | User name or password refused | Type them again (**Update connection details** once the records are in your database); on a pooler the user name may need `.project` |
| `store_role_too_powerful` | The app role can do more than read and write its tables | Run the setup SQL again with new roles; never the admin user |
| `store_schema_conflict` | The database holds tables Lotties did not create for this baby | Use an empty database |
| `store_not_same_database` (409) | New details for a database that holds a baby's records open another database (empty, someone else's or unknown); nothing was changed | Type the details of the same database; to switch databases see the FAQ "How do I really switch to another database?" |
| `store_schema_ahead` | Set up by a newer Lotties | Wait for the server update |
| `byo_consent_required` | The agreement step was skipped | Go back and tick the box |
| `store_not_configured` | No details saved yet | Save them first |
| `rate_limited` (429) | Too many saves, moves or tests | Wait an hour |

**Every day** (all `503`, retried automatically; your changes wait on the phone)

| Code | Meaning | What to do |
| --- | --- | --- |
| `store_unavailable`, `store_paused_or_unreachable` | Nothing answers | Resume a paused project at your provider, wait a minute |
| `store_timeout` | Too slow to answer | Usually a sleeping database waking up: wait |
| `store_rate_limited` | Too many connections | Wait; check the provider's connection limit |
| `store_quota_full` | Storage limit reached | Free space or change the plan |
| `store_migrating` | Lotties is preparing the tables | Wait a minute |
| `store_migration_failed` | Preparing the tables failed | Lotties retries; test again later |
| `store_moving` | A move of this baby is running | Wait; it ends in seconds to minutes |
| `store_account_deleting` | The account that owns this baby is being deleted | Nothing; the baby is about to be erased |

**Moves and sharing**

| Code | Meaning | What to do |
| --- | --- | --- |
| `store_owner_only` (409) | The baby has other members or a pending invite, or someone tried to invite to a baby whose records are in your database | Remove the others / move back to Lotties hosting first |
| `store_move_in_progress` (409) | A move of this baby is already running (also blocks account deletion) | Wait until it ends |
| `store_move_not_needed` (409) | The records are already there | Nothing |
| `store_in_use` (409) | You tried to forget a database that still holds records | Move back to Lotties hosting first |
| `store_not_owned` (403) | Another account set up this database | Only that account can change it |
| `account_deletion_in_progress` (409) | Your account is being deleted | Nothing |
| `store_move_verify_failed`, `store_move_conflict`, `store_move_abandoned`, `store_move_failed` | The move failed (copy mismatch, the target refused a record, or the server gave up after 3 tries) | The baby stayed where it was; test the connection and try again |

## 14. FAQ

**Do I have to do this?** No. Lotties hosting stays the default and nothing changes for anyone who does not choose this.

**Can Lotties read my baby's records if they are in my database?** Yes. Lotties' servers read and write them to run the
app, and the people who run Lotties could read them. This is control over where the data lives, not secrecy from Lotties.

**Can I see my connection details again in the app?** No. They are shown once (while you type them) and never again. To
change them while the records are with Lotties, use **Replace the connection details** and type them again. While the
records are in your database (or when a saved database shows a problem), use **Update connection details**: type the
current details of the same database, then **Save new details and test**. This is also the way out after you changed a
role's password at your provider: give Lotties the new password, and it can read the records again (and move them back if
you want).

**Can I point Lotties at a different database with Update connection details?** No. While a baby's records are in your
database, new details are saved only when they open that same database: before saving, Lotties reads (and only reads) the
small `lotties.store_meta` table through both addresses you typed and checks that it names your database. A new password,
a new user, a new host or pooler address of the same database, or the same database after your provider moved it, all
pass. An empty database (a typo in the project name, another project), a database Lotties set up for someone else, or one
it cannot recognize is refused with `store_not_same_database`: nothing is created there and your saved details stay as
they were. If Lotties cannot connect with the new details at all (wrong password, paused project), the save is refused
with that reason instead, also without changing anything.

**How do I really switch to another database?** In three steps: **Move back to Lotties hosting** (the records are copied
to Lotties and the baby points there), then **Replace the connection details** with the new database (no baby's records
are read from your database any more, so any empty database is accepted), test, and **Move my records there**. The copy
left in the old database during the undo window is no longer deleted by Lotties once its details are replaced: drop the
`lotties` schema there yourself when you no longer need it. The same is true before you ever moved records: until a
baby's records are in your database, the details can point at any database.

**Does it cost money?** Lotties does not charge for it. Your provider may; free plans exist at the time of writing, with
limits that change. Lotties does not recommend a provider.

**Can I share the baby with my partner?** Not while the records are in your own database (first version). Move them back
to Lotties hosting to invite someone.

**Will reminders work?** Not for that baby, in this first version.

**What if my provider closes my account or deletes the database?** The records there are gone unless you have a backup.
Download a backup from Lotties (Hub > Export data) regularly. Your phone also keeps a copy of what it has synced.

**Can I look at or query the records myself?** Yes, they are in the `lotties` schema of your database. Do not change or
delete Lotties' tables by hand: Lotties may refuse a database it no longer recognizes (`store_schema_conflict`).

**Which region should I choose?** One close to you. If it is outside your country, the transfer rules of your country's
privacy law apply (Lotties' privacy policy, section "Your own database").
