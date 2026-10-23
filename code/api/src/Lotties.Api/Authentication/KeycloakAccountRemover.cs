using System.Net.Http.Headers;
using System.Text.Json;
using Lotties.Application.Users;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Authentication;

/// <summary>
/// Removes the account at Keycloak with the admin REST API, using a service account (client credentials) that may
/// manage users in the realm of <see cref="AuthOptions.Authority"/>. Without <c>Auth:AdminClientId</c> and
/// <c>Auth:AdminClientSecret</c> nothing is called and the account stays (the web app tells the user).
/// A failure is logged and reported as "not removed": the data is already erased by then.
/// </summary>
internal sealed class KeycloakAccountRemover(HttpClient http, IOptions<AuthOptions> options, ILogger<KeycloakAccountRemover> logger) : IIdentityAccountRemover
{
    public async Task<bool> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        if (!settings.CanRemoveAccounts || !IsAuthority(issuer, settings.Authority!))
        {
            return false;
        }

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
                return true;
            }

            logger.LogWarning("Keycloak refused to delete an account: HTTP {StatusCode}", (int)response.StatusCode);
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException or UriFormatException or TaskCanceledException)
        {
            logger.LogWarning(exception, "Removing the account at Keycloak failed");
        }

        return false;
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

/// <summary>The identity provider is not managed from here: the sign-in account stays.</summary>
internal sealed class NoIdentityAccountRemover : IIdentityAccountRemover
{
    public Task<bool> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default) => Task.FromResult(false);
}
