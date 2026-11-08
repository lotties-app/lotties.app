using Lotties.Application.Users;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Stores;

/// <summary>
/// Who may reach the data-store routes (section <c>Stores</c>; docs/design/47-bring-your-own-database.md D11 and section 12
/// "Staged rollout"): the feature flag <c>Stores:Enabled</c> (off by default, the same flag as the routing, the sealed credentials and
/// the migrator) and the account allowlist <c>Stores:Allowlist</c> (e.g. env <c>Stores__Allowlist__0=&lt;user id&gt;</c>), empty by
/// default so nobody can use the feature until the operator names the accounts. An entry is an account id (the <c>users.id</c>
/// guid) or an OIDC subject (<c>sub</c>). E-mail addresses are not matched: the API never reads the <c>email</c> claim.
/// </summary>
public sealed class DataStoreAccessOptions
{
    public const string SectionName = "Stores";

    /// <summary>Most entries of <see cref="Allowlist"/> (the MVP is the owner and a few testers).</summary>
    public const int MaxAllowlistEntries = 100;

    public bool Enabled { get; set; }

    public List<string> Allowlist { get; set; } = [];

    /// <summary>Whether the account <paramref name="userId"/>, signed in as <paramref name="subject"/>, is listed.</summary>
    public bool Allows(Guid userId, string subject) =>
        Allowlist.Select(entry => entry.Trim()).Any(entry => Matches(entry, userId, subject));

    private static bool Matches(string entry, Guid userId, string subject) =>
        entry.Length > 0
        && ((Guid.TryParse(entry, out var listed) && listed == userId) || string.Equals(entry, subject, StringComparison.Ordinal));
}

/// <summary>Fails startup on an allowlist that is too long.</summary>
internal sealed class DataStoreAccessOptionsValidator : IValidateOptions<DataStoreAccessOptions>
{
    public ValidateOptionsResult Validate(string? name, DataStoreAccessOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return options.Allowlist.Count <= DataStoreAccessOptions.MaxAllowlistEntries
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail($"{DataStoreAccessOptions.SectionName}:{nameof(DataStoreAccessOptions.Allowlist)} takes at most {DataStoreAccessOptions.MaxAllowlistEntries} entries.");
    }
}

/// <summary>Endpoint metadata: the route manages a baby's data store (task T6).</summary>
internal sealed class DataStoreEndpointMetadata
{
    private DataStoreEndpointMetadata()
    {
    }

    public static DataStoreEndpointMetadata Instance { get; } = new();
}

/// <summary>
/// Runs right after authentication, on data-store routes only: while <see cref="DataStoreAccessOptions.Enabled"/> is false every such
/// route answers a bare 404 before any 401 or 403, so a disabled feature looks like no route (as the project board does).
/// </summary>
internal sealed class DataStoreRequestGuard(RequestDelegate next, IOptionsMonitor<DataStoreAccessOptions> options)
{
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<DataStoreEndpointMetadata>() is not null && !options.CurrentValue.Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next(context);
    }
}

/// <summary>
/// The allowlist of the data-store routes: an endpoint filter, so it runs after authentication, the Owner policy, the consent gate and
/// the demo gate, and answers a bare 404 to an Owner whose account is not listed (the feature does not exist for her). Members who are
/// not the Owner never get this far (403 from the policy), whatever the list says.
/// </summary>
internal static class DataStoreAllowlistFilter
{
    public static async ValueTask<object?> CheckAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(invocation);
        ArgumentNullException.ThrowIfNull(next);
        var http = invocation.HttpContext;
        var options = http.RequestServices.GetRequiredService<IOptionsMonitor<DataStoreAccessOptions>>().CurrentValue;
        var user = await http.RequestServices.GetRequiredService<ICurrentUser>().GetUserAsync(http.RequestAborted);
        return options.Allows(user.Id, user.Subject) ? await next(invocation) : Results.NotFound();
    }
}

internal static class DataStoreAccessExtensions
{
    /// <summary>Binds and validates (at startup) <see cref="DataStoreAccessOptions"/>.</summary>
    public static IServiceCollection AddDataStoreAccess(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<DataStoreAccessOptions>().Bind(configuration.GetSection(DataStoreAccessOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<DataStoreAccessOptions>, DataStoreAccessOptionsValidator>();
        return services;
    }

    public static IApplicationBuilder UseDataStoreRequestGuard(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<DataStoreRequestGuard>();
    }
}
