using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Users;

/// <summary>An application user, identified by the external OIDC subject.</summary>
public sealed class User
{
    public const int SubjectMaxLength = 255;
    public const int DisplayNameMaxLength = 100;

    private User()
    {
    }

    private User(Guid id, string subject, string displayName, DateTimeOffset createdAt)
    {
        Id = id;
        Subject = subject;
        DisplayName = displayName;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    /// <summary>The OIDC <c>sub</c> claim; opaque and stored verbatim.</summary>
    public string Subject { get; private set; } = string.Empty;

    public string DisplayName { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public static User Create(string subject, string displayName, DateTimeOffset createdAt) => new(
        Guid.NewGuid(),
        ValidateSubject(subject),
        Text.Required(displayName, nameof(DisplayName), DisplayNameMaxLength),
        UtcTime.Normalize(createdAt));

    /// <summary>Creates the user for a first sign-in, taking the display name from the provider's profile claims.</summary>
    public static User Register(ExternalIdentity identity, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return Create(identity.Subject, identity.DisplayName, createdAt);
    }

    public void Rename(string displayName) =>
        DisplayName = Text.Required(displayName, nameof(DisplayName), DisplayNameMaxLength);

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
