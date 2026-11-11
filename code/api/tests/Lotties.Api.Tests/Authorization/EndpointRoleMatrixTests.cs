using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Lotties.Api.Tests.Board;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Board;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Authorization;

/// <summary>
/// Every mapped endpoint x every caller (Owner, Parent, Caregiver, Viewer, Doctor, non-member, anonymous). <see cref="Matrix"/>
/// holds the role decision of each route; <see cref="Matrix_CoversEveryMappedEndpoint"/> fails when a route is mapped
/// without a decision (or a decision is left for a route that no longer exists), so a new endpoint cannot ship
/// without one. A denied call must be exactly 401 (anonymous) or 403; an allowed call must get past authorization
/// (any status but 401/403/5xx: the requests carry an empty JSON body, so validation may answer 400).
/// On top of the role decision, <see cref="Scopes"/> holds the doctor scope each route needs from a Doctor
/// (docs/design/16-doctor-access.md "scopes"): <see cref="Scopes_EveryRouteADoctorMayCallHasAScopeDecision"/> fails when a
/// route a Doctor may call has neither a scope nor an entry in <see cref="OpenToEveryDoctor"/>. The host has bring-your-own-database
/// on (<see cref="StoresApiFactory"/>) so the data-store routes answer instead of a flat 404; hosted babies are unaffected by it.
/// </summary>
public sealed partial class EndpointRoleMatrixTests(StoresApiFactory factory) : IClassFixture<StoresApiFactory>
{
    /// <summary>Who may call a route.</summary>
    public enum Access
    {
        /// <summary>No sign-in needed.</summary>
        Anonymous,

        /// <summary>Any signed-in user (no baby involved, or the route reads only the caller's own data).</summary>
        SignedIn,

        /// <summary>Any member of the baby (<c>BabyRead</c>).</summary>
        Read,

        /// <summary>
        /// Family members only: Owner, Parent, Caregiver, Viewer, never the Doctor (<c>BabyReadFamily</c>): appointments
        /// and the members list (docs/design/16-doctor-access.md, "Doctor read audit").
        /// </summary>
        ReadFamily,

        /// <summary>Owner, Parent, Caregiver (<c>BabyLog</c>): events and the caller's own reminder preferences.</summary>
        Log,

        /// <summary>Owner, Parent (<c>BabyWrite</c>).</summary>
        Write,

        /// <summary>Owner only (<c>BabyManageMembers</c>).</summary>
        Owner,

        /// <summary>Owner, Parent, Doctor (<c>BabyMeasure</c>): growth measurements; a Doctor changes only her own.</summary>
        Measure,

        /// <summary>The Doctor only (<c>BabyNote</c>): notes; only the author changes a note.</summary>
        Note,

        /// <summary>The Doctor only (<c>BabyPropose</c>): prescription proposals; only the author changes or withdraws one.</summary>
        Propose,

        /// <summary>
        /// Project board readers (<c>BoardRead</c>: a board realm role or a board API key, no baby involved; docs/design/36).
        /// Every baby caller is refused (no board role): 401 anonymous, else 403. <see cref="BoardMatrix"/> has the board callers.
        /// </summary>
        BoardRead,

        /// <summary>Project board writers (<c>BoardWrite</c>: writer or admin role, or a write key).</summary>
        BoardWrite,

        /// <summary>Project board admins (<c>BoardAdmin</c>: the admin role only; never a key).</summary>
        BoardAdmin,
    }

    /// <summary>The callers every board route is tried with (<see cref="BoardMatrix"/>).</summary>
    public enum BoardCaller
    {
        NoRole,
        Reader,
        Writer,
        Admin,
        ReadKey,
        WriteKey,
        Anonymous,
    }

    /// <summary>The callers every route is tried with.</summary>
    public enum Caller
    {
        Owner,
        Parent,
        Caregiver,
        Viewer,
        Doctor,
        NonMember,
        Anonymous,
    }

    /// <summary>The role decision of every route, keyed by <c>"METHOD /route/pattern"</c> as the endpoint data source lists it.</summary>
    public static readonly IReadOnlyDictionary<string, Access> Matrix = new Dictionary<string, Access>(StringComparer.Ordinal)
    {
        ["GET /health"] = Access.Anonymous,
        // The running release (name, version, commit, build time): public, shown on the About screen.
        ["GET /api/v1/version"] = Access.Anonymous,
        // The try-it demo (docs/design/45-try-it-demo.md): anonymous by nature, the start is rate limited per address.
        ["GET /api/v1/demo"] = Access.Anonymous,
        ["POST /api/v1/demo/start"] = Access.Anonymous,
        ["GET /api/v1/me"] = Access.SignedIn,
        ["GET /api/v1/me/deletion-preview"] = Access.SignedIn,
        ["DELETE /api/v1/me"] = Access.SignedIn,
        // The caller's own professional profile: any signed-in user may declare one (needed to accept a Doctor invite).
        ["GET /api/v1/me/professional-profile"] = Access.SignedIn,
        ["PUT /api/v1/me/professional-profile"] = Access.SignedIn,
        ["PUT /api/v1/me/profile"] = Access.SignedIn,

        ["GET /api/v1/babies"] = Access.SignedIn,
        ["POST /api/v1/babies"] = Access.SignedIn,
        ["GET /api/v1/babies/{babyId:guid}"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}"] = Access.Owner,
        // The vaccine profile (coverage, gestational age, the mother's RSV vaccination): Owners and Parents.
        ["PUT /api/v1/babies/{babyId:guid}/vaccine-profile"] = Access.Write,

        // The members list (names and roles of the family): family members only, a Doctor gets 403; she can still leave.
        ["GET /api/v1/babies/{babyId:guid}/members"] = Access.ReadFamily,
        ["PATCH /api/v1/babies/{babyId:guid}/members/{userId:guid}"] = Access.Owner,
        ["DELETE /api/v1/babies/{babyId:guid}/members/{userId:guid}"] = Access.Owner,
        ["DELETE /api/v1/babies/{babyId:guid}/members/me"] = Access.Read,

        ["POST /api/v1/babies/{babyId:guid}/invites"] = Access.Owner,
        ["GET /api/v1/babies/{babyId:guid}/invites"] = Access.Owner,
        ["DELETE /api/v1/babies/{babyId:guid}/invites/{inviteId:guid}"] = Access.Owner,
        ["POST /api/v1/invites/accept"] = Access.SignedIn,
        ["POST /api/v1/invites/{token}/accept"] = Access.SignedIn,

        ["GET /api/v1/babies/{babyId:guid}/event-types"] = Access.Read,
        ["POST /api/v1/babies/{babyId:guid}/event-types"] = Access.Write,
        ["PUT /api/v1/babies/{babyId:guid}/event-types/{eventTypeId:guid}"] = Access.Write,
        ["DELETE /api/v1/babies/{babyId:guid}/event-types/{eventTypeId:guid}"] = Access.Write,

        // The shared catalog is instance-wide (no baby): any signed-in user, whatever their roles on babies.
        ["GET /api/v1/catalog/products"] = Access.SignedIn,
        ["GET /api/v1/catalog/products/{productId:guid}"] = Access.SignedIn,
        ["POST /api/v1/catalog/products"] = Access.SignedIn,
        ["GET /api/v1/catalog/substances"] = Access.SignedIn,
        ["GET /api/v1/catalog/substances/{substanceId:guid}/products"] = Access.SignedIn,

        ["GET /api/v1/babies/{babyId:guid}/medications"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}/medications/{medicationId:guid}"] = Access.Write,
        ["DELETE /api/v1/babies/{babyId:guid}/medications/{medicationId:guid}"] = Access.Write,

        ["GET /api/v1/babies/{babyId:guid}/measurements"] = Access.Read,
        // A Doctor adds consultation measurements and edits or deletes only her own (403 measurement_not_owned).
        ["PUT /api/v1/babies/{babyId:guid}/measurements/{measurementId:guid}"] = Access.Measure,
        ["DELETE /api/v1/babies/{babyId:guid}/measurements/{measurementId:guid}"] = Access.Measure,

        ["GET /api/v1/babies/{babyId:guid}/prescriptions"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}/prescriptions/{prescriptionId:guid}"] = Access.Write,
        ["DELETE /api/v1/babies/{babyId:guid}/prescriptions/{prescriptionId:guid}"] = Access.Write,
        ["GET /api/v1/babies/{babyId:guid}/medications/status"] = Access.Read,

        // Formulas: everyone reads them (a Caregiver picks one when logging a bottle, which the events PUT allows her);
        // only Owners and Parents create, edit, set the current one or archive (there is no delete).
        ["GET /api/v1/babies/{babyId:guid}/formulas"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}/formulas/{formulaId:guid}"] = Access.Write,

        // Appointments: every family member reads them (the list with its delta and range, one by id); only Owners and
        // Parents create, edit, mark done or cancel (there is no delete). Caregivers and Viewers read only. The Doctor
        // gets 403 on every appointment route (they name other doctors, clinics and private reasons).
        ["GET /api/v1/babies/{babyId:guid}/appointments"] = Access.ReadFamily,
        ["GET /api/v1/babies/{babyId:guid}/appointments/{appointmentId:guid}"] = Access.ReadFamily,
        ["PUT /api/v1/babies/{babyId:guid}/appointments/{appointmentId:guid}"] = Access.Write,

        // Care providers ("My doctors", docs/design/22-care-providers.md): every family member reads the directory (list
        // with its delta); only Owners and Parents create, edit or soft delete (no delete route). Caregivers and Viewers
        // read only. The Doctor gets 403 on every route.
        ["GET /api/v1/babies/{babyId:guid}/care-providers"] = Access.ReadFamily,
        ["PUT /api/v1/babies/{babyId:guid}/care-providers/{providerId:guid}"] = Access.Write,

        // Address lookup proxy (docs/design/23-address-lookup.md): instance-wide, no baby involved and nothing about a baby is
        // sent upstream, so any signed-in user (the web only offers it in the provider sheet, i.e. to Owners and Parents).
        // Rate limited per user.
        ["GET /api/v1/address/lookup"] = Access.SignedIn,
        ["GET /api/v1/address/search"] = Access.SignedIn,

        // Vaccines: the schedule is the same for everyone (any signed-in user); every member reads a baby's records,
        // a Doctor included; only Owners and Parents record, edit or delete. Caregivers, Viewers and the Doctor read only.
        ["GET /api/v1/vaccine-schedule"] = Access.SignedIn,
        ["GET /api/v1/babies/{babyId:guid}/vaccinations"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}/vaccinations/{vaccinationId:guid}"] = Access.Write,
        ["DELETE /api/v1/babies/{babyId:guid}/vaccinations/{vaccinationId:guid}"] = Access.Write,

        // Age norms (docs/design/28-age-norms.md): published facts, the same file for everyone, no baby involved: any
        // signed-in user.
        ["GET /api/v1/age-norms"] = Access.SignedIn,

        ["GET /api/v1/babies/{babyId:guid}/events"] = Access.Read,
        ["GET /api/v1/babies/{babyId:guid}/events/{eventId:guid}"] = Access.Read,
        // A Caregiver passes the policy; the use case then allows only their own events, plus stopping, pausing or
        // resuming someone else's running one (PUT only), else 403 event_not_owned (CaregiverEndpointTests).
        ["PUT /api/v1/babies/{babyId:guid}/events/{eventId:guid}"] = Access.Log,
        ["DELETE /api/v1/babies/{babyId:guid}/events/{eventId:guid}"] = Access.Log,

        ["GET /api/v1/babies/{babyId:guid}/predictions"] = Access.Read,
        // Her rhythm (docs/design/48-baby-rhythm.md): computed from the log like the predictions, same roles (Viewer reads).
        ["GET /api/v1/babies/{babyId:guid}/rhythm"] = Access.Read,

        // The doctor's lean views (docs/design/16-doctor-access.md): her dashboard lists only the babies she is a Doctor of (any
        // signed-in user may call it: a parent gets an empty list); the clinical summary is open to every member and filters
        // its own sections by the caller's scopes; the timeline is the daily log (the daily_log scope for a Doctor).
        ["GET /api/v1/doctor/patients"] = Access.SignedIn,
        ["GET /api/v1/babies/{babyId:guid}/clinical-summary"] = Access.Read,
        ["GET /api/v1/babies/{babyId:guid}/timeline"] = Access.Read,

        // Notes (docs/design/16-doctor-access.md): every member reads the shared ones (a private note only its author,
        // filtered by the use case); only the Doctor writes, and only her own (403 note_not_owned).
        ["GET /api/v1/babies/{babyId:guid}/notes"] = Access.Read,
        ["GET /api/v1/babies/{babyId:guid}/notes/{noteId:guid}"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}/notes/{noteId:guid}"] = Access.Note,
        ["DELETE /api/v1/babies/{babyId:guid}/notes/{noteId:guid}"] = Access.Note,
        ["GET /api/v1/babies/{babyId:guid}/access-log"] = Access.Owner,

        // Doctor access step 2 (docs/design/16-doctor-access.md section 10). Note reads: any member who sees the note marks
        // it read and lists her own reads. Proposals: every member passes the read policy and the use case filters (Owner
        // and Parent all, the Doctor her own, Caregiver and Viewer an empty list and 404 by id); only the Doctor writes and
        // withdraws (her own; another doctor's is 404); only Owners and Parents accept or decline. Prescriptions and
        // medications stay Write: the Doctor never changes them directly.
        ["PUT /api/v1/babies/{babyId:guid}/notes/{noteId:guid}/read"] = Access.Read,
        ["GET /api/v1/babies/{babyId:guid}/note-reads"] = Access.Read,
        ["GET /api/v1/babies/{babyId:guid}/prescription-proposals"] = Access.Read,
        ["GET /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}"] = Access.Read,
        ["PUT /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}"] = Access.Propose,
        ["DELETE /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}"] = Access.Propose,
        ["POST /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}/accept"] = Access.Write,
        ["POST /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}/decline"] = Access.Write,

        ["POST /api/v1/babies/{babyId:guid}/import/napper/preview"] = Access.Write,
        ["POST /api/v1/babies/{babyId:guid}/import/napper"] = Access.Write,

        // Export and import of a baby's data (docs/design/24-export-import.md): Owner and Parent export and merge; anyone signed in restores into a new baby of their own.
        ["GET /api/v1/babies/{babyId:guid}/export"] = Access.Write,
        ["POST /api/v1/babies/{babyId:guid}/import/backup/preview"] = Access.Write,
        ["POST /api/v1/babies/{babyId:guid}/import/backup"] = Access.Write,
        ["POST /api/v1/babies/import/preview"] = Access.SignedIn,
        ["POST /api/v1/babies/import"] = Access.SignedIn,

        // The baby's own database (docs/design/47-bring-your-own-database.md, task T6): Owner only, every other member 403. Doctor
        // scope decision: none needed, she is refused by role whatever her scopes (the store, its credentials and moving the records
        // are the family's, never a clinical section). 404 while Stores:Enabled is off (before any 401) and for an Owner whose
        // account is not on Stores:Allowlist (this host turns the flag on; its Owners are not listed, so they get 404: past
        // authorization). Blocked in the demo; rate limited per account.
        ["GET /api/v1/babies/{babyId:guid}/data-store"] = Access.Owner,
        ["PUT /api/v1/babies/{babyId:guid}/data-store"] = Access.Owner,
        ["DELETE /api/v1/babies/{babyId:guid}/data-store"] = Access.Owner,
        ["POST /api/v1/babies/{babyId:guid}/data-store/test"] = Access.Owner,
        ["POST /api/v1/babies/{babyId:guid}/data-store/move-in"] = Access.Owner,
        ["POST /api/v1/babies/{babyId:guid}/data-store/move-out"] = Access.Owner,

        // Community insights consent (docs/design/34-community-insights.md section 3, task T2): per baby, an Owner or a Parent sees the
        // state and turns it on or off; Caregiver, Viewer and Doctor 403. Doctor scope decision: none, she is refused by role whatever
        // her scopes (the consent is the family's, never a clinical section; design 34 section 3.4). 404 while CommunityInsights:Enabled
        // is off (before any 401; on in this host). Blocked in the demo. No store binding (control plane).
        ["GET /api/v1/babies/{babyId:guid}/community-consent"] = Access.Write,
        ["PUT /api/v1/babies/{babyId:guid}/community-consent"] = Access.Write,

        ["GET /api/v1/push/config"] = Access.SignedIn,
        ["POST /api/v1/push/subscriptions"] = Access.SignedIn,
        ["POST /api/v1/push/subscriptions/revoke"] = Access.SignedIn,
        ["GET /api/v1/push/subscriptions"] = Access.SignedIn,
        ["DELETE /api/v1/push/subscriptions/{subscriptionId:guid}"] = Access.SignedIn,
        ["GET /api/v1/push/settings"] = Access.SignedIn,
        ["PUT /api/v1/push/settings"] = Access.SignedIn,
        ["GET /api/v1/push/preferences"] = Access.SignedIn,
        ["POST /api/v1/push/test"] = Access.SignedIn,
        ["POST /api/v1/push/deliveries/{deliveryId:guid}/actions"] = Access.Anonymous,
        ["POST /api/v1/push/devices"] = Access.SignedIn,
        ["DELETE /api/v1/push/devices/{deviceId:guid}"] = Access.SignedIn,
        ["PUT /api/v1/babies/{babyId:guid}/notification-preferences"] = Access.Log,

        // Voice assistants (docs/design/32-assistants.md): the caller's own default baby (any signed-in user; the PUT accepts
        // only a baby she can log for). The Alexa skill route is anonymous at the ASP.NET level: Amazon's request signature
        // and the account-linking token in the body authenticate it (like the push action route's token); it answers 404
        // while Alexa is disabled (the default, as in this host).
        ["GET /api/v1/me/assistant-settings"] = Access.SignedIn,
        ["PUT /api/v1/me/assistant-settings"] = Access.SignedIn,
        ["POST /api/v1/alexa"] = Access.Anonymous,

        // Measurement units (docs/design/37-measurement-units.md): the caller's own display setting; any signed-in user, Doctor included.
        ["GET /api/v1/me/unit-settings"] = Access.SignedIn,
        ["PUT /api/v1/me/unit-settings"] = Access.SignedIn,
        // Feeding settings (time bottle feedings): the caller's own preference; any signed-in user, Doctor included.
        ["GET /api/v1/me/feeding-settings"] = Access.SignedIn,
        ["PUT /api/v1/me/feeding-settings"] = Access.SignedIn,

        // Caregiver rest (docs/design/41-caregiver-rest.md): the caller's own settings and morning answers; any signed-in user, nobody else reads them.
        ["GET /api/v1/me/rest-settings"] = Access.SignedIn,
        ["PUT /api/v1/me/rest-settings"] = Access.SignedIn,
        ["DELETE /api/v1/me/rest-settings"] = Access.SignedIn,
        ["PUT /api/v1/me/rest/morning"] = Access.SignedIn,
        ["GET /api/v1/me/rest"] = Access.SignedIn, // reads baby events only of the caller own non-Doctor memberships and answers only for her
        ["GET /api/v1/me/rest/history"] = Access.SignedIn, // the same reads as GET /me/rest over 14 or 28 nights, recomputed, answers only for her

        // Consent (docs/design/38-consent-and-terms.md): the caller's own consent records; any signed-in user, Doctor included, and
        // open to a person who has not consented yet (ConsentGateCoverageTests lists every route that is exempt from the gate).
        ["GET /api/v1/me/consents"] = Access.SignedIn,
        ["PUT /api/v1/me/consents/core"] = Access.SignedIn,
        ["PUT /api/v1/me/consents/optional/{kind}"] = Access.SignedIn,

        // MCP server (docs/design/32-assistants.md section 9): authenticated by its own OAuth scheme (McpTokens, audience
        // lotties-mcp, scopes lotties.read / lotties.write), never the API's, so Anonymous here; the roles and the baby choice
        // are the command layer's (McpProtocolTests, McpHttpTests). Every route answers 404 while MCP is disabled (the
        // default, as in this host). GET and DELETE answer 405 (stateless Streamable HTTP); the metadata is public.
        ["POST /api/v1/mcp"] = Access.Anonymous,
        ["GET /api/v1/mcp"] = Access.Anonymous,
        ["DELETE /api/v1/mcp"] = Access.Anonymous,
        ["GET /.well-known/oauth-protected-resource"] = Access.Anonymous,
        ["GET /.well-known/oauth-protected-resource/api/v1/mcp"] = Access.Anonymous,

        // Project board (docs/design/36-project-board.md): internal project tracking, no baby involved. Keycloak realm roles
        // (lotties-board-reader / -writer / -admin) or a board API key (read / write scope, never admin); every route
        // answers 404 while Board:Enabled is false (on in this host). Baby roles give nothing here (BoardMatrix below).
        ["GET /api/v1/board/me"] = Access.BoardRead,
        ["GET /api/v1/board/topics"] = Access.BoardRead,
        ["PUT /api/v1/board/topics/{key}"] = Access.BoardAdmin,
        ["GET /api/v1/board/items"] = Access.BoardRead,
        ["POST /api/v1/board/items"] = Access.BoardWrite,
        ["POST /api/v1/board/items/bulk"] = Access.BoardWrite,
        ["GET /api/v1/board/items/{id:guid}"] = Access.BoardRead,
        ["PATCH /api/v1/board/items/{id:guid}"] = Access.BoardWrite,
        ["POST /api/v1/board/items/{id:guid}/comments"] = Access.BoardWrite,
        ["DELETE /api/v1/board/items/{id:guid}"] = Access.BoardWrite,
        ["POST /api/v1/board/items/{id:guid}/restore"] = Access.BoardAdmin,
        ["GET /api/v1/board/summary"] = Access.BoardRead,
        ["GET /api/v1/board/export"] = Access.BoardRead,
        ["GET /api/v1/board/keys"] = Access.BoardAdmin,
        ["POST /api/v1/board/keys"] = Access.BoardAdmin,
        ["DELETE /api/v1/board/keys/{id:guid}"] = Access.BoardAdmin,

        // The board's MCP endpoint (docs/design/36-project-board.md section 9): the board's own callers (a realm role or a
        // board key, BoardRead; the write tools check the write permission per call, BoardMcpProtocolTests). 404 unless
        // Board:Enabled and Board:Mcp:Enabled (both on in this host). GET and DELETE answer 405 (stateless Streamable HTTP).
        ["POST /api/v1/board/mcp"] = Access.BoardRead,
        ["GET /api/v1/board/mcp"] = Access.Anonymous,
        ["DELETE /api/v1/board/mcp"] = Access.Anonymous,
    };

    /// <summary>
    /// The doctor scope (<c>BabyScope:*</c> policy) each route of a baby needs from a Doctor, on top of the role decision in
    /// <see cref="Matrix"/>. Every other member is unaffected by scopes. The refused-by-role routes (writes, invites, ...)
    /// are not listed: they stay closed to a Doctor whatever her scopes.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, DoctorScope> Scopes = new Dictionary<string, DoctorScope>(StringComparer.Ordinal)
    {
        ["GET /api/v1/babies/{babyId:guid}/event-types"] = DoctorScope.DailyLog,
        ["GET /api/v1/babies/{babyId:guid}/events"] = DoctorScope.DailyLog,
        ["GET /api/v1/babies/{babyId:guid}/events/{eventId:guid}"] = DoctorScope.DailyLog,
        ["GET /api/v1/babies/{babyId:guid}/predictions"] = DoctorScope.DailyLog,
        ["GET /api/v1/babies/{babyId:guid}/rhythm"] = DoctorScope.DailyLog,
        ["GET /api/v1/babies/{babyId:guid}/timeline"] = DoctorScope.DailyLog,

        ["GET /api/v1/babies/{babyId:guid}/measurements"] = DoctorScope.Growth,
        ["PUT /api/v1/babies/{babyId:guid}/measurements/{measurementId:guid}"] = DoctorScope.Growth,
        ["DELETE /api/v1/babies/{babyId:guid}/measurements/{measurementId:guid}"] = DoctorScope.Growth,

        ["GET /api/v1/babies/{babyId:guid}/medications"] = DoctorScope.Medications,
        ["GET /api/v1/babies/{babyId:guid}/prescriptions"] = DoctorScope.Medications,
        ["GET /api/v1/babies/{babyId:guid}/medications/status"] = DoctorScope.Medications,
        ["GET /api/v1/babies/{babyId:guid}/prescription-proposals"] = DoctorScope.Medications,
        ["GET /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}"] = DoctorScope.Medications,
        ["PUT /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}"] = DoctorScope.Medications,
        ["DELETE /api/v1/babies/{babyId:guid}/prescription-proposals/{proposalId:guid}"] = DoctorScope.Medications,

        ["GET /api/v1/babies/{babyId:guid}/formulas"] = DoctorScope.Formulas,
        ["GET /api/v1/babies/{babyId:guid}/vaccinations"] = DoctorScope.Vaccines,

        ["GET /api/v1/babies/{babyId:guid}/notes"] = DoctorScope.Notes,
        ["GET /api/v1/babies/{babyId:guid}/notes/{noteId:guid}"] = DoctorScope.Notes,
        ["PUT /api/v1/babies/{babyId:guid}/notes/{noteId:guid}"] = DoctorScope.Notes,
        ["DELETE /api/v1/babies/{babyId:guid}/notes/{noteId:guid}"] = DoctorScope.Notes,
        ["PUT /api/v1/babies/{babyId:guid}/notes/{noteId:guid}/read"] = DoctorScope.Notes,
        ["GET /api/v1/babies/{babyId:guid}/note-reads"] = DoctorScope.Notes,
    };

    /// <summary>
    /// The routes a Doctor may call that need no scope ("open to every doctor"), each with the reason. A route a Doctor can
    /// call per <see cref="Matrix"/> must be here or in <see cref="Scopes"/>, so a new route cannot ship without a scope decision.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> OpenToEveryDoctor = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["GET /api/v1/babies/{babyId:guid}"] = "The baby's name and birth date: the minimum a doctor needs to know whom she treats.",
        ["DELETE /api/v1/babies/{babyId:guid}/members/me"] = "Leaving: a doctor can always end her own access.",
        ["GET /api/v1/babies/{babyId:guid}/clinical-summary"] = "Filters its own sections by the caller's scopes, so it never leaks a section she lacks.",
    };

    public static TheoryData<string, DoctorScope> ScopedRoutes()
    {
        var cases = new TheoryData<string, DoctorScope>();
        foreach (var (route, scope) in Scopes)
        {
            cases.Add(route, scope);
        }

        return cases;
    }

    /// <summary>The scoped routes that members other than the Doctor can call too (not the Doctor-only notes and proposals writes).</summary>
    public static TheoryData<string, DoctorScope> ScopedRoutesOfOtherMembers()
    {
        var cases = new TheoryData<string, DoctorScope>();
        foreach (var (route, scope) in Scopes.Where(entry => RolesThatCan(Matrix[entry.Key]).Any()))
        {
            cases.Add(route, scope);
        }

        return cases;
    }

    /// <summary>The family's routes (members, appointments, invites, the access log, reminders, imports) that a Doctor never reaches.</summary>
    public static TheoryData<string> FamilyOnlyRoutes() => new()
    {
        "GET /api/v1/babies/{babyId:guid}/members",
        "GET /api/v1/babies/{babyId:guid}/appointments",
        "GET /api/v1/babies/{babyId:guid}/appointments/{appointmentId:guid}",
        "PUT /api/v1/babies/{babyId:guid}/appointments/{appointmentId:guid}",
        "PATCH /api/v1/babies/{babyId:guid}/members/{userId:guid}",
        "DELETE /api/v1/babies/{babyId:guid}/members/{userId:guid}",
        "POST /api/v1/babies/{babyId:guid}/invites",
        "GET /api/v1/babies/{babyId:guid}/invites",
        "DELETE /api/v1/babies/{babyId:guid}/invites/{inviteId:guid}",
        "GET /api/v1/babies/{babyId:guid}/access-log",
        "PUT /api/v1/babies/{babyId:guid}/notification-preferences",
        "POST /api/v1/babies/{babyId:guid}/import/napper/preview",
        "POST /api/v1/babies/{babyId:guid}/import/napper",
        "GET /api/v1/babies/{babyId:guid}/export",
        "POST /api/v1/babies/{babyId:guid}/import/backup/preview",
        "POST /api/v1/babies/{babyId:guid}/import/backup",
        "GET /api/v1/babies/{babyId:guid}/data-store",
        "PUT /api/v1/babies/{babyId:guid}/data-store",
        "DELETE /api/v1/babies/{babyId:guid}/data-store",
        "POST /api/v1/babies/{babyId:guid}/data-store/test",
        "POST /api/v1/babies/{babyId:guid}/data-store/move-in",
        "POST /api/v1/babies/{babyId:guid}/data-store/move-out",
        "GET /api/v1/babies/{babyId:guid}/community-consent",
        "PUT /api/v1/babies/{babyId:guid}/community-consent",
    };

    public static TheoryData<string, Caller> Cases()
    {
        var cases = new TheoryData<string, Caller>();
        foreach (var route in Matrix.Keys)
        {
            Array.ForEach(Enum.GetValues<Caller>(), caller => cases.Add(route, caller));
        }

        return cases;
    }

    [Fact]
    public void Matrix_CoversEveryMappedEndpoint()
    {
        var mapped = MappedRoutes();

        var missing = mapped.Except(Matrix.Keys).Order().ToArray();
        var stale = Matrix.Keys.Except(mapped).Order().ToArray();

        Assert.True(missing.Length == 0, $"Routes without a role decision in {nameof(Matrix)}: {string.Join(", ", missing)}");
        Assert.True(stale.Length == 0, $"Decisions for routes that are not mapped: {string.Join(", ", stale)}");
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Route_ByCaller_FollowsTheMatrix(string route, Caller caller)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);

        var response = await SendAsync(ClientFor(baby, caller), route, baby.BabyId);

        AssertOutcome(Expected(Matrix[route], caller), response, $"{route} as {caller}");
    }

    [Fact]
    public void Scopes_EveryRouteADoctorMayCallHasAScopeDecision()
    {
        var doctorRoutes = Matrix.Where(entry => Expected(entry.Value, Caller.Doctor) is null && entry.Value is not (Access.Anonymous or Access.SignedIn)).Select(entry => entry.Key);

        var undecided = doctorRoutes.Where(route => !Scopes.ContainsKey(route) && !OpenToEveryDoctor.ContainsKey(route)).Order().ToArray();

        Assert.True(undecided.Length == 0, $"Routes a Doctor may call without a scope decision (add them to {nameof(Scopes)} or {nameof(OpenToEveryDoctor)}): {string.Join(", ", undecided)}");
    }

    [Fact]
    public void Scopes_DecisionsAreForRoutesThatExistAndAreNotBothScopedAndOpen()
    {
        var unknown = Scopes.Keys.Concat(OpenToEveryDoctor.Keys).Except(Matrix.Keys).Order().ToArray();
        var both = Scopes.Keys.Intersect(OpenToEveryDoctor.Keys).Order().ToArray();

        Assert.True(unknown.Length == 0, $"Scope decisions for routes that are not in the matrix: {string.Join(", ", unknown)}");
        Assert.True(both.Length == 0, $"Routes both scoped and open to every doctor: {string.Join(", ", both)}");
    }

    [Fact]
    public void Scopes_EveryScopeGuardsAtLeastOneRoute()
    {
        var unused = Enum.GetValues<DoctorScope>().Except(Scopes.Values).ToArray();

        Assert.Empty(unused);
    }

    [Theory]
    [MemberData(nameof(ScopedRoutes))]
    public async Task ScopedRoute_DoctorWithoutTheScope_Is403(string route, DoctorScope scope)
    {
        var withoutIt = DoctorScopeSet.Create(Enum.GetValues<DoctorScope>().Where(other => other != scope));
        var baby = await factory.SeedBabyAsync(withoutIt, BabyRole.Doctor);

        var response = await SendAsync(factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor)), route, baby.BabyId);

        Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{route} without {scope}: expected 403, got {(int)response.StatusCode}");
    }

    [Theory]
    [MemberData(nameof(ScopedRoutes))]
    public async Task ScopedRoute_DoctorWithOnlyTheScope_PassesAuthorization(string route, DoctorScope scope)
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([scope]), BabyRole.Doctor);

        var response = await SendAsync(factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor)), route, baby.BabyId);

        AssertOutcome(expectedDenial: null, response, $"{route} with only {scope}");
    }

    [Theory]
    [MemberData(nameof(ScopedRoutes))]
    public async Task ScopedRoute_DoctorWithNoScopeAtAll_Is403(string route, DoctorScope scope)
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.None, BabyRole.Doctor);

        var response = await SendAsync(factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor)), route, baby.BabyId);

        Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{route} ({scope}) without any scope: expected 403, got {(int)response.StatusCode}");
    }

    [Theory]
    [MemberData(nameof(ScopedRoutesOfOtherMembers))]
    public async Task ScopedRoute_MembersOtherThanTheDoctor_AreNotAffectedByScopes(string route, DoctorScope scope)
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.None, BabyRole.Doctor);
        var role = RolesThatCan(Matrix[route]).First();

        var response = await SendAsync(factory.CreateClientFor(baby.SubjectOf(role)), route, baby.BabyId);

        AssertOutcome(expectedDenial: null, response, $"{route} ({scope}) as {role}");
    }

    [Theory]
    [MemberData(nameof(FamilyOnlyRoutes))]
    public async Task FamilyRoute_DoctorWithEveryScope_Is403(string route)
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.All, BabyRole.Doctor);

        var response = await SendAsync(factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor)), route, baby.BabyId);

        Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{route} as a Doctor with every scope: expected 403, got {(int)response.StatusCode}");
    }

    [Fact]
    public async Task OpenRoutes_DoctorWithNoScopeAtAll_StillReadsTheBabyAndLeaves()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.None, BabyRole.Doctor);
        var doctor = factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor));

        var details = await SendAsync(doctor, "GET /api/v1/babies/{babyId:guid}", baby.BabyId);
        var patients = await SendAsync(doctor, "GET /api/v1/doctor/patients", baby.BabyId);
        var leave = await SendAsync(doctor, "DELETE /api/v1/babies/{babyId:guid}/members/me", baby.BabyId);

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.NoContent), (details.StatusCode, patients.StatusCode, leave.StatusCode));
    }

    /// <summary>Every board route of <see cref="Matrix"/> with every board caller.</summary>
    public static TheoryData<string, BoardCaller> BoardCases()
    {
        var cases = new TheoryData<string, BoardCaller>();
        foreach (var route in Matrix.Where(entry => entry.Value is Access.BoardRead or Access.BoardWrite or Access.BoardAdmin).Select(entry => entry.Key))
        {
            Array.ForEach(Enum.GetValues<BoardCaller>(), caller => cases.Add(route, caller));
        }

        return cases;
    }

    /// <summary>
    /// The board section of the matrix: users by their Keycloak realm role (admin implies writer implies reader), keys by
    /// their scope (a write key never administers), a user without a board role 403, anonymous 401.
    /// </summary>
    [Theory]
    [MemberData(nameof(BoardCases))]
    public async Task BoardMatrix_Route_ByBoardCaller(string route, BoardCaller caller)
    {
        var client = caller switch
        {
            BoardCaller.Anonymous => factory.CreateClient(),
            BoardCaller.NoRole => factory.BoardUser(roles: null),
            BoardCaller.Reader => factory.BoardUser(BoardTestKit.Reader),
            BoardCaller.Writer => factory.BoardUser(BoardTestKit.Writer),
            BoardCaller.Admin => factory.BoardUser(BoardTestKit.Admin),
            BoardCaller.ReadKey => factory.KeyClient(await factory.SeedKeyAsync(BoardKeyScope.Read)),
            _ => factory.KeyClient(await factory.SeedKeyAsync(BoardKeyScope.Write)),
        };

        var response = await SendAsync(client, route, Guid.NewGuid());

        AssertOutcome(ExpectedForBoard(Matrix[route], caller), response, $"{route} as board {caller}");
    }

    private static HttpStatusCode? ExpectedForBoard(Access access, BoardCaller caller) => (access, caller) switch
    {
        (_, BoardCaller.Anonymous) => HttpStatusCode.Unauthorized,
        (_, BoardCaller.NoRole) => HttpStatusCode.Forbidden,
        (Access.BoardRead, _) => null,
        (Access.BoardWrite, BoardCaller.Writer or BoardCaller.Admin or BoardCaller.WriteKey) => null,
        (Access.BoardAdmin, BoardCaller.Admin) => null,
        _ => HttpStatusCode.Forbidden,
    };

    /// <summary>The roles whose seeded member passes the role policy of <paramref name="access"/> (the Doctor excluded: its scopes are the subject).</summary>
    private static IEnumerable<BabyRole> RolesThatCan(Access access) =>
        new[] { BabyRole.Owner, BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer }
            .Where(role => Expected(access, Enum.Parse<Caller>(role.ToString())) is null);

    private static void AssertOutcome(HttpStatusCode? expectedDenial, HttpResponseMessage response, string what)
    {
        var status = response.StatusCode;
        if (expectedDenial is { } denial)
        {
            Assert.True(status == denial, $"{what}: expected {(int)denial}, got {(int)status}");
            return;
        }

        Assert.True(
            status is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) && (int)status < 500,
            $"{what}: expected to pass authorization, got {(int)status}");
    }

    /// <summary>The denial status for <paramref name="caller"/>, or <c>null</c> when the call is allowed.</summary>
    private static HttpStatusCode? Expected(Access access, Caller caller) => (access, caller) switch
    {
        (Access.Anonymous, _) => null,
        (_, Caller.Anonymous) => HttpStatusCode.Unauthorized,
        (Access.SignedIn, _) => null,
        (_, Caller.NonMember) => HttpStatusCode.Forbidden,
        (Access.Read, _) => null,
        (Access.ReadFamily, Caller.Owner or Caller.Parent or Caller.Caregiver or Caller.Viewer) => null,
        (Access.Log, Caller.Owner or Caller.Parent or Caller.Caregiver) => null,
        (Access.Write, Caller.Owner or Caller.Parent) => null,
        (Access.Owner, Caller.Owner) => null,
        (Access.Measure, Caller.Owner or Caller.Parent or Caller.Doctor) => null,
        (Access.Note, Caller.Doctor) => null,
        (Access.Propose, Caller.Doctor) => null,
        _ => HttpStatusCode.Forbidden,
    };

    private HttpClient ClientFor(SeededBaby baby, Caller caller) => caller switch
    {
        Caller.Anonymous => factory.CreateClient(),
        Caller.NonMember => factory.CreateClientFor(TestUsers.NewSubject()),
        Caller.Owner => factory.CreateClientFor(baby.OwnerSubject),
        _ => factory.CreateClientFor(baby.SubjectOf(Enum.Parse<BabyRole>(caller.ToString()))),
    };

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, string route, Guid babyId)
    {
        var separator = route.IndexOf(' ', StringComparison.Ordinal);
        var method = new HttpMethod(route[..separator]);
        var path = RouteParameter().Replace(route[(separator + 1)..], match => ParameterValue(match.Groups["name"].Value, babyId));
        var request = new HttpRequestMessage(method, path);
        if (method != HttpMethod.Get && method != HttpMethod.Delete)
        {
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        }

        return client.SendAsync(request);
    }

    private static string ParameterValue(string name, Guid babyId) => name switch
    {
        "babyId" => babyId.ToString(),
        "token" => "not-a-real-token",
        _ => Guid.NewGuid().ToString(),
    };

    private HashSet<string> MappedRoutes()
    {
        var sources = factory.Services.GetRequiredService<IEnumerable<EndpointDataSource>>();
        return sources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText?.StartsWith(ProbeEndpointsStartupFilter.Prefix, StringComparison.Ordinal) == false)
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? []).Select(method => $"{method} {Normalized(endpoint.RoutePattern.RawText!)}"))
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string Normalized(string rawText) => "/" + rawText.TrimStart('/').TrimEnd('/');

    [GeneratedRegex(@"\{(?<name>\w+)(:[^}]*)?\}")]
    private static partial Regex RouteParameter();
}
