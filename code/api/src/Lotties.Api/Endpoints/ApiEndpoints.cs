using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Board;
using Lotties.Api.Board.Mcp;
using Lotties.Api.Consents;

namespace Lotties.Api.Endpoints;

public static class ApiEndpoints
{
    public const string V1Prefix = "/api/v1";

    /// <summary>Maps the anonymous <c>/health</c> probe, the authenticated <c>/api/v1</c> routes and the MCP server's routes (own OAuth scheme).</summary>
    public static WebApplication MapLottiesApi(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous().AllowWithoutConsent("The liveness probe: no user data.").DisableRateLimiting();
        // Every route under the API group is behind the consent gate unless it says otherwise (AllowWithoutConsent) and is listed in
        // ConsentGateCoverageTests: a new route is gated by default (docs/design/38-consent-and-terms.md).
        var api = app.MapGroup(V1Prefix).RequireAuthorization().RequireConsent();
        api.MapVersionEndpoints();
        api.MapDemoEndpoints();
        api.MapMeEndpoints();
        api.MapBabyCollectionEndpoints();
        api.MapInviteAcceptEndpoints();
        api.MapBabyScopedGroup().MapBabyEndpoints();
        api.MapBabyScopedGroup().MapMemberEndpoints();
        api.MapBabyScopedGroup().MapInviteEndpoints();
        api.MapBabyScopedGroup().MapEventTypeEndpoints();
        api.MapCatalogEndpoints();
        api.MapBabyScopedGroup().MapMedicationEndpoints().MapMeasurementEndpoints();
        api.MapBabyScopedGroup().MapPrescriptionEndpoints();
        api.MapBabyScopedGroup().MapFormulaEndpoints();
        api.MapBabyScopedGroup().MapAppointmentEndpoints();
        api.MapBabyScopedGroup().MapCareProviderEndpoints();
        api.MapAddressEndpoints();
        api.MapVaccineScheduleEndpoints();
        api.MapAgeNormsEndpoints();
        api.MapBabyScopedGroup().MapVaccinationEndpoints();
        api.MapBabyScopedGroup().MapNoteEndpoints().MapAccessLogEndpoints();
        api.MapBabyScopedGroup().MapProposalEndpoints();
        api.MapBabyScopedGroup().MapEventEndpoints();
        api.MapBabyScopedGroup().MapPredictionEndpoints();
        api.MapBabyScopedGroup().MapRhythmEndpoints();
        api.MapBabyScopedGroup().MapClinicalEndpoints();
        api.MapDoctorEndpoints();
        api.MapBabyScopedGroup().MapImportEndpoints();
        api.MapBabyScopedGroup().MapBackupEndpoints();
        api.MapBackupRestoreEndpoints();
        api.MapDataStoreEndpoints();
        api.MapPushEndpoints();
        api.MapBabyScopedGroup().MapNotificationPreferenceEndpoints();
        api.MapAlexaEndpoints();
        api.MapBoardEndpoints();
        app.MapMcpEndpoints();
        app.MapBoardMcpEndpoints();
        return app;
    }
}
