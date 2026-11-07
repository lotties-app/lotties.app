using System.Net;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// Settings of the egress guard of user-owned databases (section <c>StoreEndpointGuard</c>, e.g. env
/// <c>StoreEndpointGuard__DeniedNetworks__0=203.0.113.7/32</c>). Docs: docs/design/47-bring-your-own-database.md section 3.2.
/// </summary>
public sealed class StoreEndpointGuardOptions
{
    public const string SectionName = "StoreEndpointGuard";

    /// <summary>Most extra ports the operator may allow.</summary>
    public const int MaxExtraPorts = 8;

    /// <summary>Most networks on the operator's deny list.</summary>
    public const int MaxDeniedNetworks = 64;

    /// <summary>Ports allowed besides 5432 and 6543, for provider presets (1024 to 65535, at most <see cref="MaxExtraPorts"/>).</summary>
    public List<int> ExtraAllowedPorts { get; set; } = [];

    /// <summary>
    /// Public networks (CIDR, e.g. <c>203.0.113.7/32</c>) the guard refuses on top of the non-public ranges: the lab's public
    /// address, the cluster's pod and service CIDRs when they are public, the host of the control database.
    /// </summary>
    public List<string> DeniedNetworks { get; set; } = [];

    /// <summary>Timeout of one DNS resolution, in seconds (default 3, 1 to 10).</summary>
    public int ResolveTimeoutSeconds { get; set; } = 3;

    /// <summary>
    /// Test seam: also allows loopback addresses (127.0.0.0/8, ::1) so a test can run a TLS server in process. Not public,
    /// so configuration binding cannot set it: production configuration never turns it on.
    /// </summary>
    internal bool AllowLoopbackForTests { get; init; }
}

/// <summary>Fails startup on an extra port out of range, too many entries or a deny-list entry that is not a CIDR.</summary>
internal sealed class StoreEndpointGuardOptionsValidator : IValidateOptions<StoreEndpointGuardOptions>
{
    public ValidateOptionsResult Validate(string? name, StoreEndpointGuardOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new List<string>();
        CheckPorts(failures, options.ExtraAllowedPorts);
        CheckNetworks(failures, options.DeniedNetworks);
        CheckTimeout(failures, options.ResolveTimeoutSeconds);
        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static void CheckPorts(List<string> failures, List<int> ports)
    {
        if (ports.Count > StoreEndpointGuardOptions.MaxExtraPorts || ports.Any(port => port is < 1024 or > 65535))
        {
            failures.Add($"{StoreEndpointGuardOptions.SectionName}:{nameof(StoreEndpointGuardOptions.ExtraAllowedPorts)} takes at most {StoreEndpointGuardOptions.MaxExtraPorts} ports from 1024 to 65535.");
        }
    }

    private static void CheckNetworks(List<string> failures, List<string> networks)
    {
        if (networks.Count > StoreEndpointGuardOptions.MaxDeniedNetworks || !networks.All(network => IPNetwork.TryParse(network, out _)))
        {
            failures.Add($"{StoreEndpointGuardOptions.SectionName}:{nameof(StoreEndpointGuardOptions.DeniedNetworks)} takes at most {StoreEndpointGuardOptions.MaxDeniedNetworks} networks in CIDR form.");
        }
    }

    private static void CheckTimeout(List<string> failures, int seconds)
    {
        if (seconds is < 1 or > 10)
        {
            failures.Add($"{StoreEndpointGuardOptions.SectionName}:{nameof(StoreEndpointGuardOptions.ResolveTimeoutSeconds)} must be from 1 to 10.");
        }
    }
}
