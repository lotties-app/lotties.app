namespace Lotties.Api.Limits;

/// <summary>Names of the request limit policies and the endpoint conventions that apply them.</summary>
public static class RequestLimitPolicies
{
    /// <summary>Timeout and rate limit policy of the import endpoints.</summary>
    public const string Import = "import";

    /// <summary>Rate limit policy of shared catalog writes (product creation).</summary>
    public const string CatalogWrite = "catalog-write";

    /// <summary>Rate limit policy of the address lookup proxy (per user): the upstream services are shared and free.</summary>
    public const string AddressLookup = "address-lookup";

    /// <summary>Rate limit policy of push device, settings and preference writes (per user).</summary>
    public const string PushWrite = "push-write";

    /// <summary>Rate limit policy of test notifications (per user).</summary>
    public const string PushTest = "push-test";

    /// <summary>Rate limit policy of the anonymous snooze/dismiss route (per remote address).</summary>
    public const string PushAction = "push-action";

    /// <summary>Rate limit policy of the anonymous demo start (per remote address, per hour, <c>Demo:StartPermitsPerHour</c>).</summary>
    public const string DemoStart = "demo-start";

    /// <summary>Rate limit policy of the project board routes (per user, or per board API key).</summary>
    public const string Board = "board";

    /// <summary>
    /// Gives an import endpoint the import body size limit (<see cref="RequestLimitsOptions.ImportMaxRequestBodyBytes"/>),
    /// timeout and rate limit instead of the defaults.
    /// </summary>
    public static TBuilder WithImportLimits<TBuilder>(this TBuilder endpoint)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        endpoint.WithMetadata(ImportRequestLimitsMetadata.Instance);
        endpoint.WithRequestTimeout(Import);
        endpoint.RequireRateLimiting(Import);
        return endpoint;
    }
}

/// <summary>
/// Endpoint metadata: a project board route, with the board body size limit
/// (<see cref="RequestLimitsOptions.BoardMaxRequestBodyBytes"/>, or <see cref="RequestLimitsOptions.BoardBulkMaxRequestBodyBytes"/> for the bulk import).
/// </summary>
public sealed class BoardRequestLimitsMetadata
{
    private BoardRequestLimitsMetadata(bool isBulk) => IsBulk = isBulk;

    public static BoardRequestLimitsMetadata Standard { get; } = new(isBulk: false);

    public static BoardRequestLimitsMetadata Bulk { get; } = new(isBulk: true);

    public bool IsBulk { get; }
}

/// <summary>Endpoint metadata: the endpoint uses the import request limits.</summary>
public sealed class ImportRequestLimitsMetadata
{
    private ImportRequestLimitsMetadata()
    {
    }

    public static ImportRequestLimitsMetadata Instance { get; } = new();
}
