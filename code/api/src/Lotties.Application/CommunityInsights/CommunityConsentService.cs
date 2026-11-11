using Lotties.Application.Babies;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Consents;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// Section <c>CommunityInsights</c> (docs/design/34-community-insights.md section 5): the feature flag. Off by default; while it is off
/// the consent routes answer a bare 404 and nothing is collected. Turning it on in production is task T9 (activation), never before.
/// </summary>
public sealed class CommunityInsightsOptions
{
    public const string SectionName = "CommunityInsights";

    public bool Enabled { get; set; }
}

/// <summary>One line of the history as the API tells it: what changed, when, under which texts, and who (her display name; never an id).</summary>
public sealed record CommunityConsentChangeResponse(string Action, DateTimeOffset At, string TextVersion, string PolicyVersion, string ByName, bool ByMe);

/// <summary>
/// <c>GET /babies/{babyId}/community-consent</c>: the state (<c>none</c>, <c>on</c>, <c>off</c>, <c>renewal_needed</c>), the consent
/// text a yes must be for, the latest change and the whole history, newest first.
/// </summary>
public sealed record CommunityConsentResponse(
    string Status,
    string CurrentTextVersion,
    CommunityConsentChangeResponse? Latest,
    IReadOnlyList<CommunityConsentChangeResponse> History);

/// <summary>Body of <c>PUT /babies/{babyId}/community-consent</c>.</summary>
public sealed record SetCommunityConsentRequest
{
    /// <summary>On (<c>true</c>) or off (<c>false</c>); required.</summary>
    public bool? Granted { get; init; }

    /// <summary>The consent screen version she read; required to turn it on (<see cref="CommunityConsentTexts.CurrentTextVersion"/>).</summary>
    public string? TextVersion { get; init; }

    /// <summary>"I am this baby's parent or legal guardian"; must be true to turn it on.</summary>
    public bool? GuardianConfirmed { get; init; }

    /// <summary>The language of the text she read (<c>en</c>, <c>pt-BR</c>); optional.</summary>
    public string? Locale { get; init; }
}

/// <summary>
/// A baby's community insights consent (design 34 section 3, task T2): only the record and its management. Nothing is collected,
/// computed or published here; a future run (task T5) reads <see cref="ICommunityConsentRepository.BabiesInForceAsync"/>.
/// </summary>
public interface ICommunityConsentService
{
    /// <summary>The state and history; 403 <c>community_consent_not_allowed</c> for a member who is not an Owner or Parent.</summary>
    Task<CommunityConsentResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Turns it on or off for the baby. On needs the current text version (409 <c>community_consent_version_outdated</c>) and the
    /// guardian declaration (400 <c>validation_failed</c>, field <c>guardianConfirmed</c>); off needs nothing and takes effect at once.
    /// A request that changes nothing records nothing.
    /// </summary>
    Task<CommunityConsentResponse> SetAsync(Guid babyId, SetCommunityConsentRequest request, CancellationToken cancellationToken = default);
}

internal sealed class CommunityConsentService(
    ICurrentUser currentUser,
    IBabyAccessService access,
    ICommunityConsentRepository consents,
    IUserRepository users,
    TimeProvider timeProvider,
    ILogger<CommunityConsentService> logger) : ICommunityConsentService
{
    public const string GrantedField = "granted";

    public async Task<CommunityConsentResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        await EnsureMayDecideAsync(babyId, cancellationToken);
        var user = await currentUser.GetUserAsync(cancellationToken);
        return await ViewAsync(babyId, user.Id, cancellationToken);
    }

    public async Task<CommunityConsentResponse> SetAsync(Guid babyId, SetCommunityConsentRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var granted = request.Granted ?? throw new DomainValidationException(GrantedField, "granted is required (true or false).");
        await EnsureMayDecideAsync(babyId, cancellationToken);
        var user = await currentUser.GetUserAsync(cancellationToken);
        var history = await consents.HistoryAsync(babyId, cancellationToken);
        var change = history.Change(granted, babyId, user.Id, request.TextVersion, request.GuardianConfirmed == true, ConsentVersions.Current.PrivacyPolicyVersion, request.Locale, timeProvider.GetUtcNow());
        await RecordAsync(change, cancellationToken);
        return await ViewAsync(babyId, user.Id, cancellationToken);
    }

    private async Task EnsureMayDecideAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var role = await access.FindRoleAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        if (!CommunityConsentRules.MayDecide(role))
        {
            throw new CommunityConsentNotAllowedException(babyId);
        }
    }

    private async Task RecordAsync(CommunityConsentEntry? change, CancellationToken cancellationToken)
    {
        if (change is null)
        {
            return;
        }

        await consents.AddAsync(change, cancellationToken);
        logger.LogInformation("Recorded community insights consent {Action} for baby {BabyId} by user {UserId}", change.Action, change.BabyId, change.UserId);
    }

    private async Task<CommunityConsentResponse> ViewAsync(Guid babyId, Guid callerId, CancellationToken cancellationToken)
    {
        var history = await consents.HistoryAsync(babyId, cancellationToken);
        var names = await NamesAsync(history, cancellationToken);
        IReadOnlyList<CommunityConsentChangeResponse> lines = [.. history.Entries.Reverse().Select(entry => LineOf(entry, names, callerId))];
        return new CommunityConsentResponse(StatusName(history.Status), CommunityConsentTexts.CurrentTextVersion, lines.Count == 0 ? null : lines[0], lines);
    }

    private async Task<IReadOnlyDictionary<Guid, string>> NamesAsync(CommunityConsentHistory history, CancellationToken cancellationToken)
    {
        IReadOnlyCollection<Guid> ids = [.. history.Entries.Select(entry => entry.UserId).Distinct()];
        IReadOnlyList<User> found = ids.Count == 0 ? [] : await users.FindByIdsAsync(ids, cancellationToken);
        return found.ToDictionary(user => user.Id, user => user.DisplayName);
    }

    private static CommunityConsentChangeResponse LineOf(CommunityConsentEntry entry, IReadOnlyDictionary<Guid, string> names, Guid callerId) =>
        new(
            entry.Action == CommunityConsentAction.Granted ? "granted" : "withdrawn",
            entry.At,
            entry.TextVersion,
            entry.PolicyVersion,
            names.GetValueOrDefault(entry.UserId, string.Empty),
            entry.UserId == callerId);

    /// <summary>The wire name of a state.</summary>
    public static string StatusName(CommunityConsentStatus status) => status switch
    {
        CommunityConsentStatus.On => "on",
        CommunityConsentStatus.Off => "off",
        CommunityConsentStatus.RenewalNeeded => "renewal_needed",
        _ => "none",
    };
}
