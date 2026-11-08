using System.Globalization;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.Errors;

/// <summary>
/// The HTTP answer to a failure of a baby's data store (docs/design/47-bring-your-own-database.md section 5, task T8; SPEC "Events
/// sync contract"): <c>503</c> for every class, so a client keeps the change in its outbox and retries, with <c>Retry-After</c> in
/// whole seconds: the time left on the store's open circuit breaker or migrator backoff when the server knows it, else a default
/// per class (a few seconds for a busy store, half a minute otherwise). The body is the usual problem with the class's <c>code</c>
/// and a fixed sentence; nothing of the driver's error, the host, the user or an address.
/// </summary>
internal static class StoreFailureResponses
{
    public const int Status = StatusCodes.Status503ServiceUnavailable;

    /// <summary>Default wait for a store that is busy rather than broken.</summary>
    public static readonly TimeSpan ShortRetry = TimeSpan.FromSeconds(5);

    /// <summary>Default wait for every other class.</summary>
    public static readonly TimeSpan DefaultRetry = TimeSpan.FromSeconds(30);

    /// <summary>Whole seconds the client should wait (at least 1).</summary>
    public static int RetryAfterSeconds(StoreFailureException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        var wait = failure.RetryAfter ?? DefaultFor(failure.Failure);
        return Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds));
    }

    /// <summary>Adds <c>Retry-After</c> to the response.</summary>
    public static void AddRetryAfter(HttpResponse response, StoreFailureException failure)
    {
        ArgumentNullException.ThrowIfNull(response);
        response.Headers[HeaderNames.RetryAfter] = RetryAfterSeconds(failure).ToString(CultureInfo.InvariantCulture);
    }

    private static TimeSpan DefaultFor(StoreFailureClass failure) => failure switch
    {
        StoreFailureClass.Timeout or StoreFailureClass.RateLimited or StoreFailureClass.Migrating => ShortRetry,
        _ => DefaultRetry,
    };
}
