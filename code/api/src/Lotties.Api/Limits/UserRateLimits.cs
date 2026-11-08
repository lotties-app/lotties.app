using System.Globalization;
using System.Threading.RateLimiting;
using Lotties.Api.Authentication;
using Lotties.Api.Errors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Lotties.Api.Limits;

/// <summary>
/// Fixed one-minute windows per user (the OIDC <c>sub</c>; anonymous requests share a window per remote address):
/// every request counts against <see cref="RequestLimitsOptions.PermitsPerMinute"/>, import requests also against
/// <see cref="RequestLimitsOptions.ImportPermitsPerMinute"/>, catalog product creations against
/// <see cref="RequestLimitsOptions.CatalogWritePermitsPerMinute"/>, push writes and tests against their per-user limits, and
/// the anonymous push action route against <see cref="RequestLimitsOptions.PushActionPermitsPerMinute"/> per remote address, and the
/// data store saves and tests against their per-user hourly limits. A rejected request is a 429 problem with <c>code</c>
/// <see cref="ErrorCode"/> and a <c>Retry-After</c> header.
/// </summary>
internal static class UserRateLimits
{
    public const string ErrorCode = "rate_limited";

    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    private static readonly TimeSpan Hour = TimeSpan.FromHours(1);

    public static void Configure(RateLimiterOptions rateLimiter, RequestLimitsOptions limits)
    {
        ArgumentNullException.ThrowIfNull(rateLimiter);
        ArgumentNullException.ThrowIfNull(limits);
        rateLimiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        rateLimiter.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context => PerUser(context, limits.PermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.Import, context => PerUser(context, limits.ImportPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.CatalogWrite, context => PerUser(context, limits.CatalogWritePermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.AddressLookup, context => PerUser(context, limits.AddressLookupPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.PushWrite, context => PerUser(context, limits.PushWritePermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.PushTest, context => PerUser(context, limits.PushTestPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.PushAction, context => PerAddress(context, limits.PushActionPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.Board, context => FixedWindow($"board:{PartitionKey(context)}", limits.BoardPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.DataStoreWrite, context => FixedWindow($"data-store-write:{PartitionKey(context)}", limits.DataStoreWritePermitsPerHour, Hour));
        rateLimiter.AddPolicy(RequestLimitPolicies.DataStoreTest, context => FixedWindow($"data-store-test:{PartitionKey(context)}", limits.DataStoreTestPermitsPerHour, Hour));
        rateLimiter.OnRejected = WriteRejectionAsync;
    }

    private static RateLimitPartition<string> PerUser(HttpContext context, int permitsPerMinute) =>
        FixedWindow(PartitionKey(context), permitsPerMinute);

    private static RateLimitPartition<string> PerAddress(HttpContext context, int permitsPerMinute) =>
        FixedWindow($"address:{context.Connection.RemoteIpAddress}", permitsPerMinute);

    private static RateLimitPartition<string> FixedWindow(string partitionKey, int permits, TimeSpan? window = null) =>
        RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = window ?? Window,
            QueueLimit = 0,
        });

    /// <summary>The caller: the user (<c>sub</c>), a project board API key (its id; it has no <c>sub</c>), else the remote address.</summary>
    private static string PartitionKey(HttpContext context) =>
        context.User.FindFirst(OidcClaims.Subject)?.Value is { Length: > 0 } subject
            ? $"user:{subject}"
            : context.User.FindFirst(Board.BoardClaims.KeyId)?.Value is { Length: > 0 } keyId
                ? $"board-key:{keyId}"
                : $"anonymous:{context.Connection.RemoteIpAddress}";

    private static async ValueTask WriteRejectionAsync(OnRejectedContext rejected, CancellationToken cancellationToken)
    {
        var context = rejected.HttpContext;
        var retryAfter = rejected.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait) ? wait : Window;
        context.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status429TooManyRequests,
            Detail = "Too many requests; retry later.",
        };
        problem.Extensions[DomainExceptionHandler.CodeExtension] = ErrorCode;
        await context.RequestServices.GetRequiredService<IProblemDetailsService>()
            .WriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = problem });
    }
}
