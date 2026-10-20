namespace BabyRoutine.Domain.Users;

/// <summary>The identity asserted by the OIDC provider: the <c>sub</c> claim plus optional profile claims.</summary>
public sealed record ExternalIdentity(string Subject, string? Name, string? Email)
{
    /// <summary>Display name used when the provider sends neither a name nor an email.</summary>
    public const string FallbackDisplayName = "User";

    /// <summary>The first non-blank of <see cref="Name"/> and <see cref="Email"/>, trimmed and cut to the user display name limit.</summary>
    public string DisplayName => FirstNonBlank(Name, Email) is { } value ? Truncate(value) : FallbackDisplayName;

    private static string? FirstNonBlank(params string?[] candidates) =>
        candidates.Select(candidate => candidate?.Trim()).FirstOrDefault(candidate => !string.IsNullOrEmpty(candidate));

    private static string Truncate(string value) =>
        value.Length <= User.DisplayNameMaxLength ? value : value[..User.DisplayNameMaxLength].TrimEnd();
}
