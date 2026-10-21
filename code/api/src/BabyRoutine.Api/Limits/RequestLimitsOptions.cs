namespace BabyRoutine.Api.Limits;

/// <summary>
/// Request size, time and rate limits (section <c>RequestLimits</c>, e.g. env <c>RequestLimits__PermitsPerMinute</c>).
/// The import values apply to the Napper import endpoints, the others to every other route.
/// </summary>
public sealed class RequestLimitsOptions
{
    public const string SectionName = "RequestLimits";

    /// <summary>Largest request body in bytes (default 1 MiB).</summary>
    public long MaxRequestBodyBytes { get; set; } = 1024 * 1024;

    /// <summary>Largest import request body in bytes (default 6 MiB: two CSV texts of up to 5 MB each are checked by the import itself).</summary>
    public long ImportMaxRequestBodyBytes { get; set; } = 6 * 1024 * 1024;

    /// <summary>Request timeout in seconds (default 30).</summary>
    public int RequestTimeoutSeconds { get; set; } = 30;

    /// <summary>Import request timeout in seconds (default 120).</summary>
    public int ImportRequestTimeoutSeconds { get; set; } = 120;

    /// <summary>Requests per user per fixed one-minute window (default 300).</summary>
    public int PermitsPerMinute { get; set; } = 300;

    /// <summary>Import requests (preview and import) per user per fixed one-minute window (default 10).</summary>
    public int ImportPermitsPerMinute { get; set; } = 10;

    /// <summary>Shared catalog product creations per user per fixed one-minute window (default 10).</summary>
    public int CatalogWritePermitsPerMinute { get; set; } = 10;

    /// <summary>Push device, settings and preference writes per user per fixed one-minute window (default 30).</summary>
    public int PushWritePermitsPerMinute { get; set; } = 30;

    /// <summary>Test notifications per user per fixed one-minute window (default 3).</summary>
    public int PushTestPermitsPerMinute { get; set; } = 3;

    /// <summary>Anonymous snooze/dismiss requests per remote address per fixed one-minute window (default 20).</summary>
    public int PushActionPermitsPerMinute { get; set; } = 20;

    /// <summary>Names of the settings that are not positive; empty when the options are valid.</summary>
    public IReadOnlyList<string> NonPositiveSettings() =>
        new (string Name, long Value)[]
        {
            (nameof(MaxRequestBodyBytes), MaxRequestBodyBytes),
            (nameof(ImportMaxRequestBodyBytes), ImportMaxRequestBodyBytes),
            (nameof(RequestTimeoutSeconds), RequestTimeoutSeconds),
            (nameof(ImportRequestTimeoutSeconds), ImportRequestTimeoutSeconds),
            (nameof(PermitsPerMinute), PermitsPerMinute),
            (nameof(ImportPermitsPerMinute), ImportPermitsPerMinute),
            (nameof(CatalogWritePermitsPerMinute), CatalogWritePermitsPerMinute),
            (nameof(PushWritePermitsPerMinute), PushWritePermitsPerMinute),
            (nameof(PushTestPermitsPerMinute), PushTestPermitsPerMinute),
            (nameof(PushActionPermitsPerMinute), PushActionPermitsPerMinute),
        }
        .Where(setting => setting.Value <= 0)
        .Select(setting => $"{SectionName}:{setting.Name}")
        .ToArray();
}
