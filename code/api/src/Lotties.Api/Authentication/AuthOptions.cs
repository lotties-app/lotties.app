namespace Lotties.Api.Authentication;

/// <summary>Generic OIDC settings (section <c>Auth</c>, or env <c>AUTH_AUTHORITY</c> / <c>AUTH_AUDIENCE</c>).</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>The OIDC issuer URL; its discovery document provides the signing keys.</summary>
    public string? Authority { get; set; }

    /// <summary>The API identifier that access tokens must carry in <c>aud</c>.</summary>
    public string? Audience { get; set; }

    /// <summary>Whether the discovery document must be served over HTTPS. Turn off only for a local http provider.</summary>
    public bool RequireHttpsMetadata { get; set; } = true;

    /// <summary>Client id of the service account that may delete users in the realm (account deletion); optional.</summary>
    public string? AdminClientId { get; set; }

    /// <summary>Secret of <see cref="AdminClientId"/>; a deployment secret, never committed.</summary>
    public string? AdminClientSecret { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Authority) && !string.IsNullOrWhiteSpace(Audience);

    /// <summary>Whether deleting an account also removes it at the identity provider (needs both admin settings).</summary>
    public bool CanRemoveAccounts => !string.IsNullOrWhiteSpace(Authority) && !string.IsNullOrWhiteSpace(AdminClientId) && !string.IsNullOrWhiteSpace(AdminClientSecret);
}
