using Microsoft.Extensions.Options;

namespace Lotties.Api.Proxy;

/// <summary>Fails startup when a trusted proxy network is not CIDR notation (a typo must not silently trust nothing or everything).</summary>
internal sealed class ForwardedHeadersSettingsValidator : IValidateOptions<ForwardedHeadersSettings>
{
    public const string InvalidNetworkMessagePrefix =
        "ForwardedHeaders:TrustedNetworks (env FORWARDED_HEADERS_TRUSTED_NETWORKS) must list CIDR networks such as 10.0.0.0/8; not valid: ";

    public ValidateOptionsResult Validate(string? name, ForwardedHeadersSettings options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var invalid = options.InvalidEntries();
        return invalid.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(InvalidNetworkMessagePrefix + string.Join(", ", invalid));
    }
}
