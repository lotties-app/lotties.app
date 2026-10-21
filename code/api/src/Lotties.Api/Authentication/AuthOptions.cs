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

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Authority) && !string.IsNullOrWhiteSpace(Audience);
}
