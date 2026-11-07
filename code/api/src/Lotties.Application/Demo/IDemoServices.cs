using Lotties.Domain.Users;

namespace Lotties.Application.Demo;

/// <summary>Starts demo accounts (anonymous callers).</summary>
public interface IDemoService
{
    DemoStatusResponse GetStatus();

    /// <summary>
    /// Creates the demo account, its consent, a baby and about a week of sample data through the normal services, and returns
    /// the token. Throws <see cref="Domain.Exceptions.DemoDisabledException"/> while the demo is off and
    /// <see cref="Domain.Exceptions.DemoCapacityException"/> over the cap.
    /// </summary>
    Task<StartDemoResponse> StartAsync(StartDemoRequest request, CancellationToken cancellationToken = default);
}

/// <summary>Mints the bearer token of a demo user (implemented by the host: the signing is an HTTP/JWT concern).</summary>
public interface IDemoTokenIssuer
{
    string Issue(User demoUser);
}

/// <summary>Deletes expired demo accounts.</summary>
public interface IDemoCleanup
{
    /// <summary>Erases every demo account that expired at or before <paramref name="now"/> (up to a page), idempotent. Returns the counts.</summary>
    Task<DemoCleanupResult> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default);
}

public sealed record DemoCleanupResult(int Removed, int Failed);
