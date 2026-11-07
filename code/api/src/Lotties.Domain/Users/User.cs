using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Users;

/// <summary>An application user, identified by the external OIDC issuer and subject.</summary>
public sealed class User
{
    public const int IssuerMaxLength = 255;
    public const int SubjectMaxLength = 255;
    public const int DisplayNameMaxLength = 100;

    /// <summary>
    /// The issuer of users created before issuers were stored (migration <c>Wave2Hardening</c>) and of identities
    /// without an <c>iss</c> claim. A user with this issuer is claimed by the first sign-in with the same subject
    /// (<see cref="ClaimIssuer"/>).
    /// </summary>
    public const string UnknownIssuer = "";

    /// <summary>Issuer of an anonymized (deleted) user; no identity provider ever issues it.</summary>
    public const string DeletedIssuer = "urn:lotties:deleted";

    /// <summary>Issuer of a try-it demo user (docs/design/45-try-it-demo.md): minted by the API itself, never by an identity provider.</summary>
    public const string DemoIssuer = "urn:lotties:demo";

    private User()
    {
    }

    private User(Guid id, string issuer, string subject, string displayName, DateTimeOffset createdAt)
    {
        Id = id;
        Issuer = issuer;
        Subject = subject;
        DisplayName = displayName;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    /// <summary>The OIDC <c>iss</c> claim, stored verbatim; <see cref="UnknownIssuer"/> when not known.</summary>
    public string Issuer { get; private set; } = UnknownIssuer;

    /// <summary>The OIDC <c>sub</c> claim; opaque and stored verbatim. Unique together with <see cref="Issuer"/>.</summary>
    public string Subject { get; private set; } = string.Empty;

    public string DisplayName { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Whether the issuer is <see cref="UnknownIssuer"/> (a user from before issuers were stored).</summary>
    /// <summary>When the account was deleted; the row stays (as an anonymous author) so shared babies keep their history.</summary>
    public DateTimeOffset? DeletedAt { get; private set; }

    /// <summary>When a demo account is deleted automatically; <c>null</c> for every real account.</summary>
    public DateTimeOffset? DemoExpiresAt { get; private set; }

    /// <summary>Whether this is a throwaway try-it demo account (its issuer is <see cref="DemoIssuer"/>).</summary>
    public bool IsDemo => string.Equals(Issuer, DemoIssuer, StringComparison.Ordinal);

    public bool HasUnknownIssuer => Issuer.Length == 0;

    public bool IsDeleted => DeletedAt is not null;

    public static User Create(string issuer, string subject, string displayName, DateTimeOffset createdAt) => new(
        Guid.NewGuid(),
        ValidateIssuer(issuer),
        ValidateSubject(subject),
        Text.Required(displayName, nameof(DisplayName), DisplayNameMaxLength),
        UtcTime.Normalize(createdAt));

    /// <summary>
    /// Preset code (<see cref="RoleLabels.Presets"/>) or custom text shown when the user has no display name; the name is
    /// optional (docs/design/46-privacy-first-onboarding.md).
    /// </summary>
    public string? RoleLabel { get; private set; }

    /// <summary>Changes the profile the family sees: an empty name is allowed, the label stands in for it.</summary>
    public void UpdateProfile(string? displayName, string? roleLabel)
    {
        var name = Text.Optional(displayName, nameof(DisplayName), DisplayNameMaxLength) ?? string.Empty;
        DisplayName = name;
        RoleLabel = RoleLabels.Normalize(roleLabel);
    }

    /// <summary>Creates a throwaway demo account that expires at <paramref name="expiresAt"/>.</summary>
    public static User CreateDemo(string subject, string displayName, DateTimeOffset createdAt, DateTimeOffset expiresAt)
    {
        var user = Create(DemoIssuer, subject, displayName, createdAt);
        user.DemoExpiresAt = UtcTime.Normalize(expiresAt);
        return user;
    }

    /// <summary>Creates the user for a first sign-in, taking the display name from the provider's profile claims.</summary>
    public static User Register(ExternalIdentity identity, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return Create(identity.Issuer, identity.Subject, identity.DisplayName, createdAt);
    }

    public void Rename(string displayName) =>
        DisplayName = Text.Required(displayName, nameof(DisplayName), DisplayNameMaxLength);

    /// <summary>Records the issuer of a user whose issuer is unknown; a known issuer never changes.</summary>
    /// <summary>
    /// Erases everything personal: the identity (so a later sign-in with the old subject provisions a new, empty user)
    /// and the name. What the user wrote on babies that other people still use keeps pointing at this anonymous row.
    /// </summary>
    public void Anonymize(string anonymousName, DateTimeOffset deletedAt)
    {
        Issuer = DeletedIssuer;
        Subject = Id.ToString("N");
        DisplayName = Text.Required(anonymousName, nameof(DisplayName), DisplayNameMaxLength);
        RoleLabel = null;
        DeletedAt = UtcTime.Normalize(deletedAt);
        DemoExpiresAt = null;
    }

    public void ClaimIssuer(string issuer)
    {
        if (!HasUnknownIssuer)
        {
            throw new DomainValidationException(nameof(Issuer), "The issuer of this user is already known.");
        }

        Issuer = ValidateIssuer(issuer);
    }

    private static string ValidateIssuer(string? issuer)
    {
        ArgumentNullException.ThrowIfNull(issuer);
        if (issuer.Length > IssuerMaxLength)
        {
            throw new DomainValidationException(nameof(Issuer), $"Issuer must be at most {IssuerMaxLength} characters.");
        }

        return Text.EnsureNoNul(issuer, nameof(Issuer));
    }

    private static string ValidateSubject(string? subject)
    {
        if (string.IsNullOrWhiteSpace(subject))
        {
            throw new DomainValidationException(nameof(Subject), "Subject is required.");
        }

        if (subject.Length > SubjectMaxLength)
        {
            throw new DomainValidationException(nameof(Subject), $"Subject must be at most {SubjectMaxLength} characters.");
        }

        return subject;
    }
}
