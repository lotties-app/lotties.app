namespace BabyRoutine.Api.Endpoints;

public static class ApiEndpoints
{
    public const string V1Prefix = "/api/v1";

    /// <summary>Maps the anonymous <c>/health</c> probe and the authenticated <c>/api/v1</c> routes.</summary>
    public static WebApplication MapBabyRoutineApi(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
        var api = app.MapGroup(V1Prefix).RequireAuthorization();
        api.MapMeEndpoints();
        api.MapBabyScopedGroup();
        api.MapBabyScopedGroup().MapEventEndpoints();
        api.MapBabyScopedGroup().MapPredictionEndpoints();
        return app;
    }
}
