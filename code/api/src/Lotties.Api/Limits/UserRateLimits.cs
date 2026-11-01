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
/// the anonymous push action route against <see cref="RequestLimitsOptions.PushActionPermitsPerMinute"/> per remote address. A rejected request is a 429 problem with <c>code</c>
/// <see cref="ErrorCode"/> and a <c>Retry-After</c> header.
/// </summary>
internal static class UserRateLimits
{
    public const string ErrorCode = "rate_limited";

    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public static void Configure(RateLimiterOptions rateLimiter, RequestLimitsOptions limits)
    {
        ArgumentNullException.ThrowIfNull(rateLimiter);
        ArgumentNullException.ThrowIfNull(limits);
        rateLimiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        rateLimiter.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context => PerUser(context, limits.PermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.Import, context => PerUser(context, limits.ImportPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.CatalogWrite, context => PerUser(context, limits.CatalogWritePermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.PushWrite, context => PerUser(context, limits.PushWritePermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.PushTest, context => PerUser(context, limits.PushTestPermitsPerMinute));
        rateLimiter.AddPolicy(RequestLimitPolicies.PushAction, context => PerAddress(context, limits.PushActionPermitsPerMinute));
        rateLimiter.OnRejected = WriteRejectionAsync;
    }

    private static RateLimitPartition<string> PerUser(HttpContext context, int permitsPerMinute) =>
        FixedWindow(PartitionKey(context), permitsPerMinute);

    private static RateLimitPartition<string> PerAddress(HttpContext context, int permitsPerMinute) =>
        FixedWindow($"address:{context.Connection.RemoteIpAddress}", permitsPerMinute);

    private static RateLimitPartition<string> FixedWindow(string partitionKey, int permitsPerMinute) =>
        RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permitsPerMinute,
            Window = Window,
            QueueLimit = 0,
        });

    private static string PartitionKey(HttpContext context) =>
        context.User.FindFirst(OidcClaims.Subject)?.Value is { Length: > 0 } subject
            ? $"user:{subject}"
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
