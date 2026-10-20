namespace BabyRoutine.Api.Authentication;

/// <summary>Standard OIDC claim names, read verbatim (inbound claim mapping is off).</summary>
internal static class OidcClaims
{
    public const string Subject = "sub";
    public const string Name = "name";
    public const string Email = "email";
}
