using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Board;

namespace Lotties.Api.Endpoints;

public static class ApiEndpoints
{
    public const string V1Prefix = "/api/v1";

    /// <summary>Maps the anonymous <c>/health</c> probe, the authenticated <c>/api/v1</c> routes and the MCP server's routes (own OAuth scheme).</summary>
    public static WebApplication MapLottiesApi(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous().DisableRateLimiting();
        var api = app.MapGroup(V1Prefix).RequireAuthorization();
        api.MapVersionEndpoints();
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
        api.MapBabyScopedGroup().MapClinicalEndpoints();
        api.MapDoctorEndpoints();
        api.MapBabyScopedGroup().MapImportEndpoints();
        api.MapBabyScopedGroup().MapBackupEndpoints();
        api.MapBackupRestoreEndpoints();
        api.MapPushEndpoints();
        api.MapBabyScopedGroup().MapNotificationPreferenceEndpoints();
        api.MapAlexaEndpoints();
        api.MapBoardEndpoints();
        app.MapMcpEndpoints();
        return app;
    }
}
