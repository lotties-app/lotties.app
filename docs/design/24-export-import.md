# Export and import of a baby's data: a personal backup, and moving to another account or server (design, 2026-10-23)

Owner request: export and import everything the app stores about one child, for a personal backup or to move to another account or instance. One versioned, readable JSON file; an import that is idempotent, never trusts the file, shows a dry run first and never deletes what is already there. A later feature (account deletion, branch `feat/account-deletion`, Capacitor session) wants a "download my data first" step: the export is one function and one endpoint it can call as they are.

## 1. Decisions

- **Per baby.** The file is the data of one baby. A person with three babies exports three files. Nothing user-level is in it (profile, devices, push subscriptions, notification settings).
- **Built on the server.** The server is the source of truth; the local Dexie copy may be partial (a Doctor's lean sync, a baby never fully pulled) or hold unsynced changes. So the file is written by `GET /babies/{id}/export` from the same services the sync reads use (`ListChanges`, `List`), and the web first sends what is waiting in the outbox (section 6). Reading Dexie would export a stale and partial picture and could not be reused by a server-side feature such as the account deletion.
- **Import also on the server**, through the application services the app's own writes use (`IEventService.UpsertAsync`, `IPrescriptionService.UpsertAsync`, ...), inside one database transaction. That gives, for free and without a second copy of the rules: every validator of a normal write (field rules of event types, payload checks, dose rules, date limits, text limits), the role checks, the sync contract (last write wins on the client edit time, deleted stays deleted, a record of another baby is refused) and idempotence. A preview is the same run rolled back, so it reports exactly what the import then does.
- **Roles.** Owner and Parent export and import (`BabyPolicies.Write`). Caregiver, Viewer and Doctor are refused (403): a full copy of a child's health record is not something a nanny, a grandparent with read access or a doctor takes home, and a Doctor reads only the sections the family shares with her, so a file for her would need the whole scope machinery for no use. The service checks the role again (`backup_not_allowed`), so another caller cannot skip it. Restoring into a **new** baby needs only a signed-in user (she becomes its Owner); there is no baby to protect.
- **Never in the file:** other members, invites and tokens, a doctor's access and the access log, push subscriptions, notification settings and delivery records, reminder state, proposals of doctors, other people's private notes, any user id, subject, e-mail or secret. Device-local choices (pinned presets, shortcuts, language) are not the baby's record and stay on the device.
- **No new table, no migration.** The audit trail is a structured server log line per export and per import (user, baby, counts, checksum). The access log of the baby is the Doctor's read audit (`AccessLogEntry` is `View` only) and is not extended.

## 2. The file (`lotties-backup`, `schemaVersion: 1`)

A UTF-8 JSON document, indented at the top level and **one record per line** inside each section, so it can be read, searched and diffed. Text keeps its accents. `.json`, or gzip of the same bytes as `.json.gz` (the server compresses on request, `?compress=true`, the default; the browser compresses an upload with `CompressionStream` when it can; the importer recognizes gzip by its magic bytes, not by the name).

```json
{
  "format": "lotties-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-10-23T12:00:00+00:00",
  "app": { "name": "Lotties", "version": "1.0.0" },
  "exportedBy": "<stand-in id of the person who exported>",
  "baby": { "id": "...", "name": "Lia", "birthDate": "2026-08-01", "createdAt": "...", "vaccineProfile": "public+private", "gestationalAgeWeeks": 36, "rsvMaternalVaccination": "yes" },
  "eventTypes": [
    {"id":"...","babyId":"...","key":"pump","name":"Pump","icon":"water_drop","color":"#123456","hasDuration":false,"fields":[...]}
  ],
  "medications": [...], "prescriptions": [...], "formulas": [...], "careProviders": [...],
  "appointments": [...], "vaccinations": [...], "measurements": [...], "notes": [...],
  "events": [
    {"id":"...","babyId":"...","typeId":"...","startedAt":"...","endedAt":null,"payload":{...},"notes":"...","createdBy":"<stand-in>","createdAt":"...","updatedAt":"...","clientUpdatedAt":"...","deletedAt":null}
  ],
  "people": [ { "id": "<stand-in>", "displayName": "Ana" } ],
  "counts": { "baby": 1, "eventTypes": 1, "medications": 2, ... "events": 120 },
  "checksum": { "algorithm": "sha256", "value": "..." }
}
```

- **Records are the sync DTOs.** Each section holds the same objects the API returns (`MedicationResponse`, `PrescriptionResponse`, `FormulaResponse`, `CareProviderResponse`, `AppointmentResponse`, `VaccinationResponse`, `MeasurementResponse`, `NoteResponse`, `EventTypeResponse` for the baby's custom types only; `BackupEvent` for events, the same as `EventDto` with the payload as a plain object). So the file says what the API says, deleted records carry `deletedAt` / `isDeleted` (events, prescriptions, vaccinations, notes, care providers), archived formulas and cancelled appointments keep their status, and a reader needs no second vocabulary. Built-in event types are not exported: their ids are the same on every server.
- **No account is named.** Every `createdBy` / `authorUserId` is a stand-in (`BackupIds.Author`: UUID v5 of the baby and the user), the same user always gets the same stand-in in the same baby's files, and `people` maps each stand-in to the display name the family knows her by. A doctor-sourced prescription keeps `prescribedByName`, `changedByParent` and the `original` snapshot as information, but loses `prescribedByUserId` (stand-in), the `prescribedBy` person and the `proposalId`.
- **Notes** are the ones the exporter may read: shared notes of anyone and her own private ones. Another member's private note never reaches the file (the same query filter as `GET /notes`).
- **Checksum.** SHA-256 over a header line (`format|schemaVersion|exportedAt|exportedBy`), then for each section in the fixed order `baby, eventTypes, medications, prescriptions, formulas, careProviders, appointments, vaccinations, measurements, notes, events` a `#section` line and the compact JSON of each record followed by `\n` (`BackupDigest`). The exporter feeds it as it writes; the importer re-serializes the records it read, so a changed, added, removed or reordered record changes the value. It detects damage and hand edits; it is not a signature (anyone can recompute it), and nothing in the import trusts it for safety (section 4).
- **Compatibility.** Unknown members are ignored, a missing section is empty, so a later app may add to version 1. A change a version-1 reader cannot understand raises `schemaVersion`; a server reads versions up to its own and refuses a newer file with 422 `backup_unsupported_version` ("update the app").

## 3. Export

`GET /api/v1/babies/{babyId}/export?compress=true|false` (Owner, Parent; `WithImportLimits`: 120 s, 10 per minute per user). The response is the file as a download (`application/gzip` or `application/json`, `Content-Disposition: attachment; filename="lotties-backup-<name>-<yyyyMMdd>.json[.gz]"`, `Cache-Control: no-store`).

`IBackupExportService.WriteAsync(babyId, Stream, ct)` writes the file to any stream and returns the counts. It is the function the account deletion calls (it checks the caller's role itself). Memory stays flat: the events are read in pages of 500 by the events cursor and written as they come (the writer is flushed after each page; the gzip, when asked, wraps the response stream). The other sections are small lists read whole.

## 4. Import

### 4.1 Routes

| Route | Who | What |
|---|---|---|
| `POST /babies/import/preview` | any signed-in user | dry run of a restore into a new baby |
| `POST /babies/import` | any signed-in user | restore: creates a baby owned by the caller and imports into it |
| `POST /babies/{id}/import/backup/preview` | Owner, Parent | dry run of a merge into this baby |
| `POST /babies/{id}/import/backup` | Owner, Parent | merge into this baby |

The body is the file itself (plain JSON or gzip, any content type), under the import request limits (6 MiB, so a big baby is uploaded gzipped; the web compresses it). All four answer 200 with a `BackupImportReport`.

### 4.2 Reading the file (`BackupReader`)

Before anything is applied: at most 64 MiB after decompression (a gzip bomb is a 413 `backup_too_large`), the format name, the schema version, at most 150 000 events / 20 000 records of any other kind / 200 custom event types, the declared `counts` equal to the records, every record has an id, ids are unique within a section, every record names the baby the file describes, and the checksum matches (422 `backup_checksum_mismatch`). A file that is not JSON, is truncated, has the wrong format or a missing checksum is 400 `backup_invalid_file`.

### 4.3 Where records go and which ids they get

- **Restore** (`mode: restore`): the new baby's id is derived from the importer and the file's baby (`BackupIds.RestoredBaby`), so restoring the same file again finds the baby it created (the report says `babyExists`) and adds only what is missing. The importer is its Owner and its only member; the baby takes the file's name, birth date and vaccine profile. If the earlier restore's baby is no longer hers (she left it) the answer is 409 `backup_baby_unavailable`.
- **Merge** (`mode: merge`): into an existing baby the caller may write to. The baby's profile is never changed.
- **Ids.** Primary keys are global, so a record id can belong to one baby only. A record keeps its id only when the file is merged into the baby it was exported from; into any other baby (a restore, a merge of another baby's file) every id is derived from the target baby (`BackupIds.Record`: UUID v5 of kind, target baby and source id). Importing the same file twice therefore finds the same records both times, and importing a baby's file on the same server that still holds the original never collides with it. References are remapped with the ids: the medication of a prescription, the provider of an appointment, the type of an event (custom types are matched by **key**, because their id is generated on creation: an existing type with the key is reused, otherwise it is created), and inside event payloads the `medicationId` / `prescriptionId` of each medication entry and a bottle's `formula_id` (`BackupPayloads`).
- **Authors.** Whatever the file says, every record created is the importer's (`createdBy` of the service), and she is the author of imported notes. The report warns (`authors_remapped`) when the file holds entries written by other people.

### 4.4 Applying (`BackupApplier`) and the conflict rules

Order: custom event types, medications, prescriptions, formulas, care providers, appointments, vaccinations, measurements, notes, events (references first). Each record goes through the same application service as a normal write, with the records' sync times: `UpdatedAt = clientUpdatedAt` of the file, so the contract decides.

| Kind | Existing record | Result |
|---|---|---|
| events, prescriptions, formulas, care providers, appointments, vaccinations, notes (the sync kinds) | file's `clientUpdatedAt` older than the stored one | **kept** (last write wins) |
| same | file's newer and different | **updated** (the service applies it and stamps the server `updatedAt`, so devices pull it) |
| same | identical | **unchanged** |
| same | alive here, deleted in the file | **kept**: a merge never deletes |
| same | deleted here | stays deleted (**unchanged**/kept) |
| same | does not exist | **new**; a record deleted in the file is created and then soft-deleted, so the restored baby has the same tombstones |
| medications, measurements, custom event types (no client time) | exists | **unchanged** when the same, else **kept** (the existing one wins) |
| notes written by someone else here (a doctor's) | exists | **kept** (`note_not_owned` is not an error) |

Anything the normal write would refuse is an **issue** (the code is the one the write answers with: `validation_failed` with the field, `event_type_not_available`, `event_baby_mismatch`, `medication_baby_mismatch`, ...): the record is counted `invalid`, the import goes on to list the others, and at the end nothing is saved. A medication linked to a catalog product this server does not know keeps its data without the link (`product_links_dropped`).

### 4.5 Dry run and confirmation

The preview opens the transaction, applies, and rolls back (`IBackupSession`: one explicit transaction on the request's context; `EfFormulaRepository.InTransactionAsync` joins it instead of nesting; the change tracker is cleared after every record, so thousands of events stay cheap). It returns the report: the file's origin, counts per kind (`total, new, unchanged, updated, kept, invalid`), up to 50 issues (`issueCount` is the full count), and notices (`authors_remapped`, `doctor_provenance_dropped`, `doctor_measurements_flattened`, `product_links_dropped`). `canImport` is false while there is an issue. The import runs the same steps, commits only when there is no issue, and otherwise answers 422 `backup_rejected` with the issues. The web asks for an explicit click on the confirm button after showing the report; the server does not trust that and validates again.

### 4.6 A hostile file

It cannot reach another baby or account: ids are derived from the target, and a record that does claim an id owned by another baby (a merge of a file that names the target baby as its own) meets the service's mismatch check and becomes an issue; roles are not in the file, so none can be granted; the importer's own baby is the only one written; sizes and counts are capped; every text, number and date meets the domain limits; payloads are limited to 16 KB and checked against the type's fields. The rate limit is the import one (10 per minute per user).

## 5. What is not restored

- The doctor provenance of a prescription (it becomes the family's own entry; the free text `prescriber` and the information fields stay), a consultation measurement's "recorded by" mark, the author of notes and entries written by other members (all become the importer's). The report says so before the import.
- Members, invites, doctors' access, reminders, notification state: by design.
- Pinned presets and the other device settings: per device (`localStorage`), not the baby's record.
- Creation and last-change times of the importing server (`createdAt`, `updatedAt`) are the import's; the file's `clientUpdatedAt` is kept as the conflict time.

## 6. Web

- Hub > App: **Export data** (`/hub/export`, Owner and Parent) and **Import backup** (`/hub/backup`, Owner and Parent with a baby selected, and anyone with no baby yet, except a doctor who only has patients).
- **Export:** explains what is and is not in the file, the privacy warning ("the file holds a child's health data, is not encrypted: keep it safe, do not send it by e-mail or chat"), a "compress" switch (default on), then the button: `syncNow()`, count the baby's unsynced outbox, and when some changes could not be sent show "Not everything on this device could be sent first (N), so those changes are not in the file" with "Export anyway"; then `GET /export`, saved through the browser's download (`saveBlob`: an object URL and a link click). Progress is an indeterminate bar with a live status. There is no Capacitor file or share adapter in the app yet, so the native shell uses the same browser path; when one exists `saveBlob` is the single place to swap.
- **Import:** a file picker (`.json`, `.json.gz`), "A new baby" / "Add to {baby}", the file is gzipped in the browser when it is over 64 KB and `CompressionStream` exists, checked against the 6 MB upload limit, and previewed at once (and again when the destination changes). The review shows the counts per kind in words ("100 new, 15 already there, 5 kept as they are"), notices, and invalid records with their reason; the confirm button is disabled while there are issues or nothing to add. After the import the sync runs and "Open the app" selects the new baby.
- All text through `t()` (`locales/<lang>/backup.json`, `hub.entries.export|backupImport`, `errors.backup_*`), en and pt-BR; targets 44 px or more, a live status for progress and results, lists with labels, text wraps (`overflow-wrap`) at 320 px.

## 7. Tests

API (`Lotties.Api.Tests/Backups`): export (every section, soft-deleted records, readable lines, no account id or other member's private note anywhere in the file, gzip default, role matrix, 3 200 events in pages); restore round trip (every list of the new baby equals the original's except ids and authors; references remapped; importer is the only member and author), restore twice (nothing changes, one baby), preview writes nothing and equals the import, merge into the same baby (no-op, ids kept), merge into another baby (derived ids, existing records untouched, twice is a no-op), merge sync rules (newer wins, older never overwrites, a deletion in the file does not delete), 2 500 events gzipped round trip; hostile files (not JSON, truncated, wrong format, broken gzip, newer schema, edited content, removed record, no checksum, record of another baby, duplicate ids, gzip bomb, too many records, invalid records listed by the preview and refused by the import with nothing written, a file claiming another baby's record ids, no access to the source baby, unknown product link). `EndpointRoleMatrixTests` has a row for each of the five routes; `RequestLimitTests` counts the import-limited routes.

Web (`code/web/src/backup`): the model (file name, upload preparation, wording of counts, notices and errors), the export screen (blocked for a Viewer, compress on and off, sync first, unsent warning and "Export anyway", failure) and the import screen (preview then import, merge mode, Viewer and no-baby cases, invalid records, nothing to do, newer version, damaged file, too large, failed import).

## 8. Not done / open

- Postgres-only behavior (`jsonb`, `xmin`, the partial unique index of the current formula inside the import transaction) is covered by the shared model tests only; the API tests run on SQLite.
- No resumable or chunked upload: one request, up to 6 MiB gzipped (about 60 MB of JSON).
- No encryption of the file and no password option; the privacy copy tells the person to keep it safe.
- No cross-baby move in one step (export from one account, import in another is the move).
- The account deletion's "download my data first" step only needs to call `IBackupExportService.WriteAsync` (server) or `GET /export` (web, `exportBackup` + `saveBlob`); it is not wired here.
