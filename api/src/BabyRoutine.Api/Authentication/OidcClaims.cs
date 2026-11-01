namespace BabyRoutine.Api.Authentication;

/// <summary>Standard OIDC claim names, read verbatim (inbound claim mapping is off). The email claim is never read.</summary>
internal static class OidcClaims
{
    public const string Issuer = "iss";
    public const string Subject = "sub";
    public const string Name = "name";
    public const string PreferredUsername = "preferred_username";
    public const string Nickname = "nickname";
}
