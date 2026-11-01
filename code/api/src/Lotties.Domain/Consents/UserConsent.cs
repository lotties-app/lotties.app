using Lotties.Domain.Common;

namespace Lotties.Domain.Consents;

/// <summary>
/// A person's current consent of one <see cref="ConsentKind"/> (one row per user and kind; docs/design/38-consent-and-terms.md).
/// It keeps the user id, the version, when it was given, the language the text was shown in and, for the core consent, the capacity
/// she declared. No IP address and no device data. It dies with the account (<c>EfAccountDataEraser</c>).
/// </summary>
public sealed class UserConsent
{
    /// <summary>The longest locale tag kept.</summary>
    public const int MaxLocaleLength = 16;

    /// <summary>What is stored when the client sent no usable locale.</summary>
    public const string UnknownLocale = "und";

    private UserConsent()
    {
        Version = string.Empty;
        Locale = UnknownLocale;
    }

    public Guid UserId { get; private set; }

    public ConsentKind Kind { get; private set; }

    /// <summary>The consent version she gave it under (<see cref="ConsentVersions"/>); the version in force when an optional one was last changed.</summary>
    public string Version { get; private set; }

    /// <summary>When the current grant was given.</summary>
    public DateTimeOffset AcceptedAt { get; private set; }

    /// <summary>When she turned an optional consent off; <c>null</c> while it is on.</summary>
    public DateTimeOffset? WithdrawnAt { get; private set; }

    /// <summary>The declared capacity of the core consent; <c>null</c> for optional ones.</summary>
    public ConsentCapacity? Capacity { get; private set; }

    /// <summary>The language tag of the text she saw (<c>en</c>, <c>pt-BR</c>), or <see cref="UnknownLocale"/>.</summary>
    public string Locale { get; private set; }

    /// <summary>Whether the consent is in force (not withdrawn).</summary>
    public bool IsGranted => WithdrawnAt is null;

    public static UserConsent Grant(Guid userId, ConsentKind kind, string version, ConsentCapacity? capacity, string? locale, DateTimeOffset now)
    {
        var consent = new UserConsent { UserId = Ids.Required(userId, nameof(userId)), Kind = kind };
        consent.Regrant(version, capacity, locale, now);
        return consent;
    }

    /// <summary>Gives the consent (again): a new version, or an optional one turned back on.</summary>
    public void Regrant(string version, ConsentCapacity? capacity, string? locale, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(version);
        Version = version;
        Capacity = Kind == ConsentKind.Core ? capacity ?? throw new ArgumentException("The core consent needs a capacity.", nameof(capacity)) : null;
        Locale = CleanLocale(locale);
        AcceptedAt = UtcTime.Normalize(now);
        WithdrawnAt = null;
    }

    /// <summary>Turns an optional consent off. Returns <c>false</c> when it already was off.</summary>
    public bool Withdraw(string version, DateTimeOffset now)
    {
        if (WithdrawnAt is not null)
        {
            return false;
        }

        Version = version;
        WithdrawnAt = UtcTime.Normalize(now);
        return true;
    }

    /// <summary>A locale tag of letters, digits and dashes up to <see cref="MaxLocaleLength"/>; anything else is <see cref="UnknownLocale"/>.</summary>
    public static string CleanLocale(string? locale)
    {
        var trimmed = locale?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxLocaleLength || !trimmed.All(character => char.IsAsciiLetterOrDigit(character) || character == '-'))
        {
            return UnknownLocale;
        }

        return trimmed;
    }
}

/// <summary>What a history row records.</summary>
public enum ConsentAction
{
    Granted,
    Withdrawn,
}

/// <summary>
/// One line of the append-only history of a person's consents (who consented to which version, when, in which language). The only
/// proof of consent the service keeps; erased with the account (a minimal proof kept after deletion is a question for the lawyer,
/// docs/PRIVACY-LAWYER-BRIEF.md).
/// </summary>
public sealed class UserConsentHistoryEntry
{
    private UserConsentHistoryEntry()
    {
        Version = string.Empty;
        Locale = UserConsent.UnknownLocale;
    }

    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public ConsentKind Kind { get; private set; }

    public ConsentAction Action { get; private set; }

    public string Version { get; private set; }

    public DateTimeOffset At { get; private set; }

    public ConsentCapacity? Capacity { get; private set; }

    public string Locale { get; private set; }

    public static UserConsentHistoryEntry Of(UserConsent consent, ConsentAction action, DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(consent);
        return new UserConsentHistoryEntry
        {
            Id = Guid.NewGuid(),
            UserId = consent.UserId,
            Kind = consent.Kind,
            Action = action,
            Version = consent.Version,
            At = UtcTime.Normalize(at),
            Capacity = consent.Capacity,
            Locale = consent.Locale,
        };
    }
}
