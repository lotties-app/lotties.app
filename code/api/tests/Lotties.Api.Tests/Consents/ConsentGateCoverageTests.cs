using Lotties.Api.Consents;
using Lotties.Api.Tests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Consents;

/// <summary>
/// Every mapped route is either behind the consent gate or exempt, and the exempt ones are exactly <see cref="Exempt"/>
/// (docs/design/38-consent-and-terms.md section 2, decision 4). The API group is gated by default (<c>RequireConsent</c>), so a new
/// route is gated until someone exempts it in the code (<c>AllowWithoutConsent(reason)</c>) <b>and</b> lists it here with the reason:
/// this test fails on a route that is neither gated nor listed, on a listed route that is not exempt, and on a stale entry.
/// </summary>
public sealed class ConsentGateCoverageTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string MeReason = "The person's own account, profile, settings and consent records: no baby data, and she can always see, change and delete what is hers.";
    private const string ReferenceReason = "Reference data or a third-party lookup: no baby is involved.";
    private const string OutsideReason = "Authenticated by something other than a signed-in user (a signature, a one-time token, a board role or key) and answered by its own layer.";

    /// <summary>Every route that does not need a current core consent, with why.</summary>
    public static readonly IReadOnlyDictionary<string, string> Exempt = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["GET /health"] = "The liveness probe.",
        ["GET /api/v1/version"] = "The running release: public build facts.",

        ["GET /api/v1/me"] = MeReason,
        ["DELETE /api/v1/me"] = "Leaving: a person can always delete her account.",
        ["GET /api/v1/me/deletion-preview"] = "Leaving: what deleting the account would remove.",
        ["GET /api/v1/me/professional-profile"] = MeReason,
        ["PUT /api/v1/me/professional-profile"] = MeReason,
        ["GET /api/v1/me/assistant-settings"] = MeReason,
        ["PUT /api/v1/me/assistant-settings"] = MeReason,
        ["GET /api/v1/me/unit-settings"] = MeReason,
        ["PUT /api/v1/me/unit-settings"] = MeReason,
        ["GET /api/v1/me/consents"] = MeReason,
        ["PUT /api/v1/me/consents/core"] = MeReason,
        ["PUT /api/v1/me/consents/optional/{kind}"] = MeReason,

        ["GET /api/v1/catalog/products"] = ReferenceReason,
        ["GET /api/v1/catalog/products/{productId:guid}"] = ReferenceReason,
        ["POST /api/v1/catalog/products"] = ReferenceReason,
        ["GET /api/v1/catalog/substances"] = ReferenceReason,
        ["GET /api/v1/catalog/substances/{substanceId:guid}/products"] = ReferenceReason,
        ["GET /api/v1/address/lookup"] = ReferenceReason,
        ["GET /api/v1/address/search"] = ReferenceReason,
        ["GET /api/v1/vaccine-schedule"] = ReferenceReason,
        ["GET /api/v1/age-norms"] = ReferenceReason,

        ["GET /api/v1/push/config"] = "The public VAPID key.",
        ["GET /api/v1/push/subscriptions"] = "The person's own devices, so she can switch them off.",
        ["POST /api/v1/push/subscriptions/revoke"] = "Switching a device off.",
        ["DELETE /api/v1/push/subscriptions/{subscriptionId:guid}"] = "Switching a device off.",
        ["POST /api/v1/push/deliveries/{deliveryId:guid}/actions"] = OutsideReason,

        ["POST /api/v1/alexa"] = OutsideReason + " The command layer answers 'open the Lotties app to accept the terms'.",
        ["POST /api/v1/mcp"] = OutsideReason + " The command layer answers an MCP error.",
        ["GET /api/v1/mcp"] = OutsideReason,
        ["DELETE /api/v1/mcp"] = OutsideReason,
        ["GET /.well-known/oauth-protected-resource"] = OutsideReason,
        ["GET /.well-known/oauth-protected-resource/api/v1/mcp"] = OutsideReason,

        ["GET /api/v1/board/me"] = "The project board is internal tracking, never baby data.",
        ["GET /api/v1/board/topics"] = "Project board.",
        ["PUT /api/v1/board/topics/{key}"] = "Project board.",
        ["GET /api/v1/board/items"] = "Project board.",
        ["POST /api/v1/board/items"] = "Project board.",
        ["POST /api/v1/board/items/bulk"] = "Project board.",
        ["GET /api/v1/board/items/{id:guid}"] = "Project board.",
        ["PATCH /api/v1/board/items/{id:guid}"] = "Project board.",
        ["POST /api/v1/board/items/{id:guid}/comments"] = "Project board.",
        ["DELETE /api/v1/board/items/{id:guid}"] = "Project board.",
        ["POST /api/v1/board/items/{id:guid}/restore"] = "Project board.",
        ["GET /api/v1/board/summary"] = "Project board.",
        ["GET /api/v1/board/export"] = "Project board.",
        ["GET /api/v1/board/keys"] = "Project board.",
        ["POST /api/v1/board/keys"] = "Project board.",
        ["DELETE /api/v1/board/keys/{id:guid}"] = "Project board.",
        ["POST /api/v1/board/mcp"] = "Project board MCP.",
        ["GET /api/v1/board/mcp"] = "Project board MCP.",
        ["DELETE /api/v1/board/mcp"] = "Project board MCP.",
    };

    [Fact]
    public void EveryRoute_IsGatedOrExempt_AndTheExemptOnesAreExactlyTheListedOnes()
    {
        var routes = Routes();

        var neither = routes.Where(route => !route.Value.Gated && !route.Value.Exempt).Select(route => route.Key).Order().ToArray();
        var exempt = routes.Where(route => route.Value.Exempt).Select(route => route.Key).ToHashSet(StringComparer.Ordinal);

        Assert.True(neither.Length == 0, $"Routes neither behind the consent gate nor exempt (map them under the API group, or AllowWithoutConsent + list them): {string.Join(", ", neither)}");
        var unlisted = exempt.Except(Exempt.Keys).Order().ToArray();
        var stale = Exempt.Keys.Except(exempt).Order().ToArray();
        Assert.True(unlisted.Length == 0, $"Routes exempt from the consent gate in the code but missing from {nameof(Exempt)}: {string.Join(", ", unlisted)}");
        Assert.True(stale.Length == 0, $"Entries of {nameof(Exempt)} that are gated or not mapped: {string.Join(", ", stale)}");
    }

    [Fact]
    public void EveryBabyRoute_IsGated()
    {
        var babyRoutes = Routes().Where(route => route.Key.Contains("/babies", StringComparison.Ordinal) || route.Key.Contains("/doctor/", StringComparison.Ordinal) || route.Key.Contains("/invites/", StringComparison.Ordinal)).ToArray();

        Assert.NotEmpty(babyRoutes);
        Assert.All(babyRoutes, route => Assert.True(route.Value.Gated && !route.Value.Exempt, $"{route.Key} must be behind the consent gate"));
    }

    [Fact]
    public void EveryExemption_HasAReason()
    {
        Assert.All(Exempt, entry => Assert.False(string.IsNullOrWhiteSpace(entry.Value), entry.Key));
        var reasons = factory.Services.GetRequiredService<IEnumerable<EndpointDataSource>>().SelectMany(source => source.Endpoints)
            .Select(endpoint => endpoint.Metadata.GetMetadata<ConsentExemptMetadata>())
            .Where(metadata => metadata is not null);
        Assert.All(reasons, metadata => Assert.False(string.IsNullOrWhiteSpace(metadata!.Reason)));
    }

    private Dictionary<string, (bool Gated, bool Exempt)> Routes()
    {
        var routes = new Dictionary<string, (bool Gated, bool Exempt)>(StringComparer.Ordinal);
        var endpoints = factory.Services.GetRequiredService<IEnumerable<EndpointDataSource>>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText?.StartsWith(ProbeEndpointsStartupFilter.Prefix, StringComparison.Ordinal) == false);
        foreach (var endpoint in endpoints)
        {
            var state = (endpoint.Metadata.GetMetadata<ConsentGatedMetadata>() is not null, endpoint.Metadata.GetMetadata<ConsentExemptMetadata>() is not null);
            foreach (var method in endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [])
            {
                routes[$"{method} /{endpoint.RoutePattern.RawText!.Trim('/')}"] = state;
            }
        }

        return routes;
    }
}
