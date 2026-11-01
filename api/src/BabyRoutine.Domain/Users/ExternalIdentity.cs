namespace BabyRoutine.Domain.Users;

/// <summary>
/// The identity asserted by the OIDC provider: the <c>iss</c> and <c>sub</c> claims plus optional profile claims
/// (<c>name</c>, <c>preferred_username</c>, <c>nickname</c>). The email is deliberately not part of it, so it can
/// never become a display name other members see.
/// </summary>
public sealed record ExternalIdentity(string Issuer, string Subject, string? Name, string? PreferredUsername = null, string? Nickname = null)
{
    /// <summary>Display name used when the provider sends no usable profile name.</summary>
    public const string FallbackDisplayName = "Parent";

    /// <summary>
    /// The first usable of <see cref="Name"/>, <see cref="PreferredUsername"/> and <see cref="Nickname"/> (trimmed,
    /// non-blank and without <c>@</c>, so an email address used as a profile claim is never shown), cut to the user
    /// display name limit; else <see cref="FallbackDisplayName"/>.
    /// </summary>
    public string DisplayName => FirstUsable(Name, PreferredUsername, Nickname) is { } value ? Truncate(value) : FallbackDisplayName;

    private static string? FirstUsable(params string?[] candidates) =>
        candidates
            .Select(candidate => candidate?.Trim())
            .FirstOrDefault(candidate => !string.IsNullOrEmpty(candidate) && !candidate.Contains('@', StringComparison.Ordinal));

    private static string Truncate(string value) =>
        value.Length <= User.DisplayNameMaxLength ? value : value[..User.DisplayNameMaxLength].TrimEnd();
}
