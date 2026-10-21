namespace BabyRoutine.Api.Limits;

/// <summary>Names of the request limit policies and the endpoint conventions that apply them.</summary>
public static class RequestLimitPolicies
{
    /// <summary>Timeout and rate limit policy of the import endpoints.</summary>
    public const string Import = "import";

    /// <summary>Rate limit policy of shared catalog writes (product creation).</summary>
    public const string CatalogWrite = "catalog-write";

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

/// <summary>Endpoint metadata: the endpoint uses the import request limits.</summary>
public sealed class ImportRequestLimitsMetadata
{
    private ImportRequestLimitsMetadata()
    {
    }

    public static ImportRequestLimitsMetadata Instance { get; } = new();
}
