namespace Lotties.Application.Demo;

/// <summary><c>GET /api/v1/demo</c>: whether the demo works on this server, and how long an account lives.</summary>
public sealed record DemoStatusResponse(bool Enabled, int LifetimeDays);

/// <summary>Body of <c>POST /api/v1/demo/start</c>; everything else a client sends is ignored.</summary>
public sealed record StartDemoRequest
{
    /// <summary><c>en</c> or <c>pt-BR</c> (names of the sample baby); anything else is English.</summary>
    public string? Locale { get; init; }
}

/// <summary>A new demo account: the bearer token (valid until <see cref="ExpiresAt"/>, not refreshable) and the sample baby.</summary>
public sealed record StartDemoResponse(string AccessToken, DateTimeOffset ExpiresAt, int LifetimeDays, Guid BabyId);
