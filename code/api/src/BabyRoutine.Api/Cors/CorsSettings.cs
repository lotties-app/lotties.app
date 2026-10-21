namespace BabyRoutine.Api.Cors;

/// <summary>Origins allowed to call the API from a browser (section <c>Cors</c>, or env <c>CORS_ALLOWED_ORIGINS</c>).</summary>
public sealed class CorsSettings
{
    public const string SectionName = "Cors";

    /// <summary>Comma-separated origins, e.g. <c>http://localhost:5173,https://baby.example.com</c>. Empty allows none.</summary>
    public string? AllowedOrigins { get; set; }

    public IReadOnlyList<string> Origins => (AllowedOrigins ?? string.Empty)
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(origin => origin.TrimEnd('/'))
        .Where(origin => origin.Length > 0)
        .ToArray();
}
