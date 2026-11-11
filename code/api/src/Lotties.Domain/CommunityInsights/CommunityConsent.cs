using Lotties.Domain.Babies;
using Lotties.Domain.Common;
using Lotties.Domain.Consents;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.CommunityInsights;

/// <summary>What one line of a baby's community insights consent history records.</summary>
public enum CommunityConsentAction
{
    Granted,
    Withdrawn,
}

/// <summary>A baby's community insights consent as the latest history line tells it.</summary>
public enum CommunityConsentStatus
{
    /// <summary>Nobody ever turned it on for the baby.</summary>
    None,

    /// <summary>Turned on under the current consent text: the only state in which a future run may use the baby (task T5).</summary>
    On,

    /// <summary>Turned off (withdrawn).</summary>
    Off,

    /// <summary>Turned on under an older consent text: excluded until an Owner or Parent says yes again (design 34 section 3.1).</summary>
    RenewalNeeded,
}

/// <summary>
/// The consent texts of community insights (docs/design/34-community-insights.md section 3): the version of the opt-in screen a person
/// read, and the purposes she accepted. A material change of the screen text (new purpose, new input, lower k, new recipient) gets a
/// new <see cref="CurrentTextVersion"/>, which turns every earlier yes into <see cref="CommunityConsentStatus.RenewalNeeded"/>.
/// </summary>
public static class CommunityConsentTexts
{
    /// <summary>The opt-in screen in force (en and pt-BR say the same thing).</summary>
    public const string CurrentTextVersion = "ci-1";

    /// <summary>The only purpose of v1: all of the published list, all or nothing (open decision O5; the column is a list for later).</summary>
    public const string AllPurposes = "all";

    /// <summary>The longest text version kept.</summary>
    public const int MaxTextVersionLength = 16;

    /// <summary>The purposes a v1 yes covers.</summary>
    public static IReadOnlyList<string> V1Scopes { get; } = [AllPurposes];
}

/// <summary>
/// Who may see and change a baby's community insights consent (design 34 sections 3.1 and 3.4): an Owner or a Parent of that baby.
/// Caregiver, Viewer and Doctor neither see it nor change it.
/// </summary>
public static class CommunityConsentRules
{
    /// <summary>Whether <paramref name="role"/> sees the state and the history and may turn it on or off.</summary>
    public static bool MayDecide(BabyRole role) => role.CanWrite();
}

/// <summary>
/// One line of the append-only community insights consent history of a baby (table <c>community_consents</c>, design 34 section 3.2):
/// who said yes or withdrew (a member's user id), under which consent text and privacy policy version, for which purposes, whether she
/// ticked the parent or guardian box, the language of the text and the server time. The current state is the latest line. Control plane:
/// it stays in the Lotties database whatever the baby's store. Never in the baby's backup file (it names accounts; docs/design/24).
/// </summary>
public sealed class CommunityConsentEntry
{
    private CommunityConsentEntry()
    {
        TextVersion = string.Empty;
        PolicyVersion = string.Empty;
        Scopes = [];
        Locale = UserConsent.UnknownLocale;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    /// <summary>The member who turned it on or off (the anonymized stand-in once her account is deleted).</summary>
    public Guid UserId { get; private set; }

    public CommunityConsentAction Action { get; private set; }

    /// <summary>The consent screen version (<see cref="CommunityConsentTexts.CurrentTextVersion"/> at the time).</summary>
    public string TextVersion { get; private set; }

    /// <summary>The privacy policy version in force at the time (<see cref="ConsentVersions"/>).</summary>
    public string PolicyVersion { get; private set; }

    /// <summary>The purposes accepted; v1 is all or nothing (<see cref="CommunityConsentTexts.V1Scopes"/>), empty on a withdrawal.</summary>
    public IReadOnlyList<string> Scopes { get; private set; }

    /// <summary>Whether she declared she is the baby's parent or legal guardian (always true on a grant; false on a withdrawal, which needs no declaration).</summary>
    public bool GuardianConfirmed { get; private set; }

    /// <summary>The language tag of the text she saw (<c>en</c>, <c>pt-BR</c>), or <see cref="UserConsent.UnknownLocale"/>.</summary>
    public string Locale { get; private set; }

    /// <summary>Server time of the change, UTC, microseconds.</summary>
    public DateTimeOffset At { get; private set; }

    /// <summary>
    /// A yes for <paramref name="babyId"/> by <paramref name="userId"/>. Refused when the screen she read is not the current one
    /// (<c>community_consent_version_outdated</c>) or when she did not tick the parent or guardian box (<c>validation_failed</c>,
    /// field <c>guardianConfirmed</c>).
    /// </summary>
    public static CommunityConsentEntry Grant(Guid babyId, Guid userId, string? textVersion, bool guardianConfirmed, string policyVersion, string? locale, DateTimeOffset at)
    {
        EnsureCurrentText(textVersion);
        if (!guardianConfirmed)
        {
            throw new DomainValidationException("guardianConfirmed", "Only a parent or legal guardian of the baby may turn community insights on.");
        }

        return New(babyId, userId, CommunityConsentAction.Granted, CommunityConsentTexts.V1Scopes, guardianConfirmed: true, policyVersion, locale, at);
    }

    /// <summary>A withdrawal for <paramref name="babyId"/> by <paramref name="userId"/>: always allowed, recorded under the current text.</summary>
    public static CommunityConsentEntry Withdraw(Guid babyId, Guid userId, string policyVersion, string? locale, DateTimeOffset at) =>
        New(babyId, userId, CommunityConsentAction.Withdrawn, [], guardianConfirmed: false, policyVersion, locale, at);

    /// <summary>A stored line as it was written (an older text version included), for readers that rebuild one outside EF Core.</summary>
    public static CommunityConsentEntry Rehydrate(
        Guid id,
        Guid babyId,
        Guid userId,
        CommunityConsentAction action,
        string textVersion,
        string policyVersion,
        IReadOnlyList<string> scopes,
        bool guardianConfirmed,
        string? locale,
        DateTimeOffset at)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(textVersion);
        ArgumentNullException.ThrowIfNull(scopes);
        var entry = New(babyId, userId, action, scopes, guardianConfirmed, policyVersion, locale, at);
        entry.Id = Ids.Required(id, nameof(id));
        entry.TextVersion = textVersion;
        return entry;
    }

    private static CommunityConsentEntry New(
        Guid babyId,
        Guid userId,
        CommunityConsentAction action,
        IReadOnlyList<string> scopes,
        bool guardianConfirmed,
        string policyVersion,
        string? locale,
        DateTimeOffset at)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(policyVersion);
        return new CommunityConsentEntry
        {
            Id = Guid.NewGuid(),
            BabyId = Ids.Required(babyId, nameof(babyId)),
            UserId = Ids.Required(userId, nameof(userId)),
            Action = action,
            TextVersion = CommunityConsentTexts.CurrentTextVersion,
            PolicyVersion = policyVersion,
            Scopes = [.. scopes],
            GuardianConfirmed = guardianConfirmed,
            Locale = UserConsent.CleanLocale(locale),
            At = UtcTime.Normalize(at),
        };
    }

    private static void EnsureCurrentText(string? textVersion)
    {
        if (string.IsNullOrWhiteSpace(textVersion))
        {
            throw new DomainValidationException("textVersion", "textVersion is required.");
        }

        if (!string.Equals(textVersion, CommunityConsentTexts.CurrentTextVersion, StringComparison.Ordinal))
        {
            throw new CommunityConsentVersionOutdatedException(textVersion.Length > CommunityConsentTexts.MaxTextVersionLength ? textVersion[..CommunityConsentTexts.MaxTextVersionLength] : textVersion);
        }
    }
}

/// <summary>
/// A baby's community insights consent history, oldest first, and what it means: the latest line decides the state, and only
/// <see cref="CommunityConsentStatus.On"/> (latest line a yes under the current text) lets a run use the baby (task T5 reads
/// <see cref="IsInForce"/>). Withdrawal is effective at once: the next line wins.
/// </summary>
public sealed class CommunityConsentHistory
{
    private CommunityConsentHistory(IReadOnlyList<CommunityConsentEntry> entries)
    {
        Entries = entries;
    }

    /// <summary>Every line, oldest first.</summary>
    public IReadOnlyList<CommunityConsentEntry> Entries { get; }

    /// <summary>The line that decides the state, or <c>null</c> before the first change.</summary>
    public CommunityConsentEntry? Latest => Entries.Count == 0 ? null : Entries[^1];

    public CommunityConsentStatus Status => StatusOf(Latest);

    /// <summary>Whether the baby may be used by a run today: the latest line is a yes under the current consent text.</summary>
    public bool IsInForce => Status == CommunityConsentStatus.On;

    /// <summary>The history of <paramref name="entries"/> in time order (ties by id, so the order is the same on every read).</summary>
    public static CommunityConsentHistory Of(IEnumerable<CommunityConsentEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        return new CommunityConsentHistory([.. entries.OrderBy(entry => entry.At).ThenBy(entry => entry.Id)]);
    }

    /// <summary>The state a latest line means.</summary>
    public static CommunityConsentStatus StatusOf(CommunityConsentEntry? latest) => latest switch
    {
        null => CommunityConsentStatus.None,
        { Action: CommunityConsentAction.Withdrawn } => CommunityConsentStatus.Off,
        { TextVersion: CommunityConsentTexts.CurrentTextVersion } => CommunityConsentStatus.On,
        _ => CommunityConsentStatus.RenewalNeeded,
    };

    /// <summary>
    /// The line that turning it on or off adds, or <c>null</c> when nothing changes (a yes while it is on, a no while it is not on: a
    /// retry or a second tap records nothing). A no while a yes under an older text is pending renewal is recorded, so the answer is
    /// explicit. The line's time is strictly after the latest one, so the latest line is always the last change.
    /// </summary>
    public CommunityConsentEntry? Change(bool granted, Guid babyId, Guid userId, string? textVersion, bool guardianConfirmed, string policyVersion, string? locale, DateTimeOffset now)
    {
        var at = After(now);
        return (granted, Status) switch
        {
            (true, CommunityConsentStatus.On) => KeepWhenCurrent(textVersion),
            (true, _) => CommunityConsentEntry.Grant(babyId, userId, textVersion, guardianConfirmed, policyVersion, locale, at),
            (false, CommunityConsentStatus.On or CommunityConsentStatus.RenewalNeeded) => CommunityConsentEntry.Withdraw(babyId, userId, policyVersion, locale, at),
            _ => null,
        };
    }

    /// <summary>A repeated yes still has to be for the current text (an old screen is refused even when nothing would change).</summary>
    private static CommunityConsentEntry? KeepWhenCurrent(string? textVersion)
    {
        if (!string.Equals(textVersion, CommunityConsentTexts.CurrentTextVersion, StringComparison.Ordinal))
        {
            throw new CommunityConsentVersionOutdatedException(textVersion is { Length: > CommunityConsentTexts.MaxTextVersionLength } ? textVersion[..CommunityConsentTexts.MaxTextVersionLength] : textVersion);
        }

        return null;
    }

    private DateTimeOffset After(DateTimeOffset now)
    {
        var normalized = UtcTime.Normalize(now);
        return Latest is { } latest && normalized <= latest.At ? latest.At.AddTicks(TimeSpan.TicksPerMillisecond / 1000) : normalized;
    }
}

/// <summary>Persistence of <see cref="CommunityConsentEntry"/> (append-only: lines are added, never changed).</summary>
public interface ICommunityConsentRepository
{
    /// <summary>The baby's history (untracked).</summary>
    Task<CommunityConsentHistory> HistoryAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The babies whose latest line is a yes under <paramref name="textVersion"/>: the population a run may read (task T5; it still
    /// applies its own exclusions, such as preterm babies and babies without an Owner or Parent).
    /// </summary>
    Task<IReadOnlyList<Guid>> BabiesInForceAsync(string textVersion, CancellationToken cancellationToken = default);

    /// <summary>Appends a line and saves it.</summary>
    Task AddAsync(CommunityConsentEntry entry, CancellationToken cancellationToken = default);
}
