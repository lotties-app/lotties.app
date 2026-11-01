using System.Net.Http.Headers;
using System.Text.Json;
using Lotties.Application.Users;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Authentication;

/// <summary>
/// Removes the account at Keycloak with the admin REST API, using a service account (client credentials) that may
/// manage users in the realm of <see cref="AuthOptions.Authority"/> (docs/KEYCLOAK-ACCOUNT-DELETION.md). Without
/// <c>Auth:AdminClientId</c> and <c>Auth:AdminClientSecret</c> nothing is called and the account stays
/// (<see cref="IdentityRemoval.NotConfigured"/>; the web app tells the user before and after).
/// A failure is logged with the Keycloak user id, so the operator can delete that user by hand, and reported as
/// <see cref="IdentityRemoval.Failed"/>: the data is already erased by then.
/// </summary>
internal sealed class KeycloakAccountRemover(HttpClient http, IOptions<AuthOptions> options, ILogger<KeycloakAccountRemover> logger) : IIdentityAccountRemover
{
    public bool CanRemove(string issuer)
    {
        var settings = options.Value;
        return settings.CanRemoveAccounts && IsAuthority(issuer, settings.Authority!);
    }

    public async Task<IdentityRemoval> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default)
    {
        if (!CanRemove(issuer))
        {
            return IdentityRemoval.NotConfigured;
        }

        var settings = options.Value;
        try
        {
            var realm = new Uri(settings.Authority!.TrimEnd('/'));
            var token = await RequestTokenAsync(realm, settings, cancellationToken);
            var segments = realm.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var adminUsers = new Uri(realm, $"/admin/realms/{Uri.EscapeDataString(segments[^1])}/users/{Uri.EscapeDataString(subject)}");
            using var request = new HttpRequestMessage(HttpMethod.Delete, adminUsers);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await http.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return IdentityRemoval.Removed;
            }

            logger.LogWarning(
                "Keycloak refused to delete the user {KeycloakUserId}: HTTP {StatusCode}. Delete that user in the realm's admin console",
                subject,
                (int)response.StatusCode);
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException or UriFormatException or TaskCanceledException or KeyNotFoundException)
        {
            logger.LogWarning(exception, "Removing the Keycloak user {KeycloakUserId} failed. Delete that user in the realm's admin console", subject);
        }

        return IdentityRemoval.Failed;
    }

    private static bool IsAuthority(string issuer, string authority) =>
        string.Equals(issuer.TrimEnd('/'), authority.TrimEnd('/'), StringComparison.Ordinal);

    private async Task<string> RequestTokenAsync(Uri realm, AuthOptions settings, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri($"{realm.AbsoluteUri.TrimEnd('/')}/protocol/openid-connect/token"))
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = settings.AdminClientId!,
                ["client_secret"] = settings.AdminClientSecret!,
            }),
        };
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        return json.RootElement.GetProperty("access_token").GetString() ?? throw new InvalidOperationException("Keycloak returned no access token.");
    }
}
