using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.AddressLookup;

/// <summary>
/// Settings of the address lookup (section <c>AddressLookup</c>, e.g. env <c>AddressLookup__ContactEmail</c>; no API keys:
/// every upstream is free and keyless). Docs: docs/design/23-address-lookup.md, docs/DEPLOY.md.
/// </summary>
public sealed class AddressLookupOptions
{
    public const string SectionName = "AddressLookup";

    /// <summary>Master switch (default true). Off: the endpoints answer 503 <c>address_lookup_disabled</c> and nothing leaves the server.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>BrasilAPI (CEP v2, with coordinates when known); the first source for a CEP.</summary>
    public string BrasilApiBaseUrl { get; set; } = "https://brasilapi.com.br";

    /// <summary>ViaCEP; the fallback source for a CEP.</summary>
    public string ViaCepBaseUrl { get; set; } = "https://viacep.com.br";

    /// <summary>OpenStreetMap Nominatim, for the free-text place search. Point it at your own instance for heavy use (the public one allows 1 request per second).</summary>
    public string NominatimBaseUrl { get; set; } = "https://nominatim.openstreetmap.org";

    /// <summary>Operator contact (e-mail) added to the identifying <c>User-Agent</c> the Nominatim usage policy asks for; optional.</summary>
    public string? ContactEmail { get; set; }

    /// <summary>Timeout of each upstream call, in seconds (default 5).</summary>
    public int TimeoutSeconds { get; set; } = 5;

    /// <summary>How long a CEP answer (found or not) is kept in memory, in minutes (default 1440).</summary>
    public int CepCacheMinutes { get; set; } = 1440;

    /// <summary>How long a place search answer is kept in memory, in minutes (default 60).</summary>
    public int SearchCacheMinutes { get; set; } = 60;

    /// <summary>Most cached answers per kind (default 1000); the cache is emptied when it fills up.</summary>
    public int CacheMaxEntries { get; set; } = 1000;

    /// <summary>Least time between two Nominatim requests of this server, in milliseconds (default 1100: the policy is 1 per second; 0 turns the spacing off, for a private instance and for tests).</summary>
    public int NominatimMinIntervalMilliseconds { get; set; } = 1100;
}

/// <summary>Fails startup on a malformed base URL, a non-positive limit or a contact that cannot go in a header.</summary>
internal sealed class AddressLookupOptionsValidator : IValidateOptions<AddressLookupOptions>
{
    public ValidateOptionsResult Validate(string? name, AddressLookupOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new List<string>();
        CheckUrl(failures, nameof(options.BrasilApiBaseUrl), options.BrasilApiBaseUrl);
        CheckUrl(failures, nameof(options.ViaCepBaseUrl), options.ViaCepBaseUrl);
        CheckUrl(failures, nameof(options.NominatimBaseUrl), options.NominatimBaseUrl);
        CheckPositive(failures, nameof(options.TimeoutSeconds), options.TimeoutSeconds);
        CheckPositive(failures, nameof(options.CepCacheMinutes), options.CepCacheMinutes);
        CheckPositive(failures, nameof(options.SearchCacheMinutes), options.SearchCacheMinutes);
        CheckPositive(failures, nameof(options.CacheMaxEntries), options.CacheMaxEntries);
        if (options.NominatimMinIntervalMilliseconds < 0)
        {
            failures.Add($"{AddressLookupOptions.SectionName}:{nameof(options.NominatimMinIntervalMilliseconds)} must not be negative.");
        }

        if (!string.IsNullOrWhiteSpace(options.ContactEmail) && !IsHeaderSafe(options.ContactEmail))
        {
            failures.Add($"{AddressLookupOptions.SectionName}:{nameof(options.ContactEmail)} must be a plain e-mail address.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static void CheckUrl(List<string> failures, string setting, string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.Query))
        {
            failures.Add($"{AddressLookupOptions.SectionName}:{setting} must be an absolute http(s) URL without a query.");
        }
    }

    private static void CheckPositive(List<string> failures, string setting, int value)
    {
        if (value <= 0)
        {
            failures.Add($"{AddressLookupOptions.SectionName}:{setting} must be positive.");
        }
    }

    private static bool IsHeaderSafe(string contact) =>
        contact.Contains('@', StringComparison.Ordinal) && contact.All(character => !char.IsControl(character) && !char.IsWhiteSpace(character) && character is not ('(' or ')' or ';'));
}
