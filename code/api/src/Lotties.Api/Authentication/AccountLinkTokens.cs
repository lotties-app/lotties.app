using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Lotties.Api.Authentication;

/// <summary>Validates an access token an assistant platform holds for the user (account linking) and returns her principal.</summary>
public interface IAccountLinkTokenValidator
{
    /// <summary>The token's principal when it passes the API's own JWT validation, else <c>null</c> (expired, wrong audience or issuer, bad signature, no <c>sub</c>).</summary>
    Task<ClaimsPrincipal?> ValidateAsync(HttpContext context, string accessToken);
}

/// <summary>
/// Account-linking tokens (docs/design/32-assistants.md section 6): an assistant platform (Alexa) sends the user's
/// Keycloak access token in the request body, not in the <c>Authorization</c> header. They are validated by a second JWT
/// bearer scheme, <see cref="SchemeName"/>, configured exactly like the API's (<see cref="ConfigureJwtBearerOptions"/>:
/// issuer, audience <c>AUTH_AUDIENCE</c>, signing keys from the authority's discovery document, lifetime, <c>sub</c>
/// required), reading the token from the request items instead of the header. Nothing is weakened or copied by hand, and
/// the token is never logged.
/// </summary>
public static class AccountLinkTokens
{
    public const string SchemeName = "AccountLink";

    private const string ItemKey = "Lotties.AccountLinkToken";

    /// <summary>The scheme's message handler: the token placed in the items, never the header; none = no result.</summary>
    public static Task ReadFromRequestItems(MessageReceivedContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.HttpContext.Items.TryGetValue(ItemKey, out var token) && token is string value && value.Length > 0)
        {
            context.Token = value;
            return Task.CompletedTask;
        }

        context.NoResult();
        return Task.CompletedTask;
    }

    internal static void Place(HttpContext context, string token) => context.Items[ItemKey] = token;

    internal static void Clear(HttpContext context) => context.Items.Remove(ItemKey);
}

/// <summary>Runs <see cref="AccountLinkTokens.SchemeName"/> on the token (the real JWT bearer handler, with the API's validation).</summary>
internal sealed class AccountLinkTokenValidator : IAccountLinkTokenValidator
{
    public async Task<ClaimsPrincipal?> ValidateAsync(HttpContext context, string accessToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentException.ThrowIfNullOrWhiteSpace(accessToken);
        AccountLinkTokens.Place(context, accessToken);
        try
        {
            var result = await context.AuthenticateAsync(AccountLinkTokens.SchemeName);
            return result.Succeeded ? result.Principal : null;
        }
        finally
        {
            AccountLinkTokens.Clear(context);
        }
    }
}
