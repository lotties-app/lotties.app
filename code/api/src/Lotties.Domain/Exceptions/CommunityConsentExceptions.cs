using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// The caller may not see or change a baby's community insights consent: only an Owner or a Parent does (the route's policy checks it
/// first; the service checks again). 403 <c>community_consent_not_allowed</c>.
/// </summary>
public sealed class CommunityConsentNotAllowedException : DomainException
{
    public CommunityConsentNotAllowedException(Guid babyId)
        : base("community_consent_not_allowed", $"Only an Owner or a Parent may see or change the community insights consent of baby {babyId}.")
    {
        BabyId = babyId;
    }

    public Guid BabyId { get; }
}

/// <summary>
/// A yes was sent for a community insights consent text that is not the current one (the person read an older screen): nothing was
/// recorded. 409 <c>community_consent_version_outdated</c>, with the current text version.
/// </summary>
public sealed class CommunityConsentVersionOutdatedException : DomainException
{
    public CommunityConsentVersionOutdatedException(string? sent)
        : base("community_consent_version_outdated", $"The community insights consent text '{sent}' is not the current one; reload and read the current text.")
    {
    }

    public override IReadOnlyDictionary<string, object?> Details { get; } =
        new Dictionary<string, object?> { ["currentTextVersion"] = CommunityConsentTexts.CurrentTextVersion };
}

/// <summary>
/// The baby's community insights consent is not in force (never given, withdrawn, or given under an older consent text): her family is
/// not served the community statistics. 403 <c>community_consent_required</c>, the same for every reason, because Caregivers and Viewers
/// may read the statistics but not the consent state (docs/design/34-community-insights.md sections 3.1 and 6).
/// </summary>
public sealed class CommunityConsentRequiredException : DomainException
{
    public CommunityConsentRequiredException(Guid babyId)
        : base("community_consent_required", "Community insights are not turned on for this baby.")
    {
        BabyId = babyId;
    }

    public Guid BabyId { get; }
}

/// <summary>
/// The caller is not a family member of the baby (a Doctor, whatever her scopes, or a non-member): the community statistics are
/// family-level, never clinical (the route's policy refuses first; the service checks again). 403 <c>community_statistics_not_allowed</c>.
/// </summary>
public sealed class CommunityStatisticsNotAllowedException : DomainException
{
    public CommunityStatisticsNotAllowedException(Guid babyId)
        : base("community_statistics_not_allowed", "Only the baby's family may read the community statistics.")
    {
        BabyId = babyId;
    }

    public Guid BabyId { get; }
}
