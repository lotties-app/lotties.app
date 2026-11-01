using System.Security.Claims;
using System.Text.Encodings.Web;
using Lotties.Api.Authentication;
using Lotties.Application.Board;
using Lotties.Domain.Board;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Lotties.Api.Board;

/// <summary>
/// The <c>BoardKey</c> authentication scheme (docs/design/36-project-board.md section 4.2): a board API key sent as
/// <c>X-Board-Key: lbk_...</c> or <c>Authorization: Bearer lbk_...</c>. The secret is hashed and compared in constant time
/// (<see cref="IBoardApiKeyService.AuthenticateAsync"/>); revoked, expired, unknown or malformed keys fail. The principal
/// has the key's id, its name (<c>name</c>), the permission claims of its scope (<c>read</c>, plus <c>write</c> for a
/// write key; never <c>admin</c>) and its topics, and no <c>sub</c>, so it is never provisioned as a user. Only the board
/// guard asks this scheme, and only on board routes.
/// </summary>
internal sealed class BoardKeyAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "BoardKey";
    public const string HeaderName = "X-Board-Key";
    private const string BearerPrefix = "Bearer ";

    /// <summary>Whether the request carries a board key (the header, or a bearer value with the <c>lbk_</c> marker).</summary>
    public static bool IsPresented(HttpRequest request) => PresentedSecret(request) is not null;

    /// <summary>The presented secret, or <c>null</c>. Several header values are joined, so they never match a key.</summary>
    public static string? PresentedSecret(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Headers.TryGetValue(HeaderName, out var header) && header.Count > 0)
        {
            return string.Join(',', header.ToArray()).Trim();
        }

        var authorization = request.Headers[HeaderNames.Authorization].ToString();
        return authorization.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase) && BoardKeySecret.HasMarker(authorization[BearerPrefix.Length..].Trim())
            ? authorization[BearerPrefix.Length..].Trim()
            : null;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (PresentedSecret(Request) is not { } secret)
        {
            return AuthenticateResult.NoResult();
        }

        var key = await Context.RequestServices.GetRequiredService<IBoardApiKeyService>().AuthenticateAsync(secret, Context.RequestAborted);
        if (key is null)
        {
            return AuthenticateResult.Fail("The board key is not valid.");
        }

        var claims = new List<Claim>
        {
            new(BoardClaims.KeyId, key.Id.ToString()),
            new(OidcClaims.Name, key.Name),
            new(BoardClaims.Permission, BoardClaims.Read),
        };
        if (key.Scope == BoardKeyScope.Write)
        {
            claims.Add(new Claim(BoardClaims.Permission, BoardClaims.Write));
        }

        claims.AddRange((key.AllowedTopics ?? []).Select(topic => new Claim(BoardClaims.Topic, topic)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName, OidcClaims.Name, ClaimTypes.Role));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer error=\"invalid_token\"";
        return Task.CompletedTask;
    }
}
