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
