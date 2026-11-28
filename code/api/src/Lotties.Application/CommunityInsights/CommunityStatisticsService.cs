using Lotties.Application.Babies;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// The community statistics one baby's family is served (docs/design/34-community-insights.md section 6 "Serving"): every v1 statistic
/// for her age in completed weeks today, from the active release.
/// </summary>
public interface ICommunityStatisticsService
{
    /// <summary>
    /// The answer for <paramref name="babyId"/>. Refused with 403 <c>demo_not_available</c> to a demo account,
    /// <c>community_statistics_not_allowed</c> to anyone but her family (Owner, Parent, Caregiver, Viewer; never a Doctor), and
    /// <c>community_consent_required</c> unless her community insights consent is in force under the current text.
    /// </summary>
    Task<CommunityStatisticsAnswer> GetAsync(Guid babyId, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Control plane only (consent history, baby row, release row): nothing of the baby's own records is read, so the baby is not bound to
/// her data store. Her age is <see cref="CommunityDays.AgeWeeksOn"/> on today's UTC day, the helper the event loader computes the
/// contributing babies' ages with.
/// </remarks>
internal sealed class CommunityStatisticsService(
    ICurrentUser currentUser,
    IBabyAccessService access,
    IBabyRepository babies,
    ICommunityConsentRepository consents,
    ICommunityStatisticsReleaseRepository releases,
    ICommunityStatisticsCatalogProvider catalogProvider,
    TimeProvider timeProvider) : ICommunityStatisticsService
{
    public async Task<CommunityStatisticsAnswer> GetAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        if ((await currentUser.GetUserAsync(cancellationToken)).IsDemo)
        {
            throw new DemoNotAvailableException();
        }

        if (await access.FindRoleAsync(babyId, cancellationToken) is not { } role || !role.CanReadFamilyRecords())
        {
            throw new CommunityStatisticsNotAllowedException(babyId);
        }

        if (!(await consents.HistoryAsync(babyId, cancellationToken)).IsInForce)
        {
            throw new CommunityConsentRequiredException(babyId);
        }

        var row = await releases.GetActiveAsync(cancellationToken);
        if (row is null || ReadRelease(row.StatisticsJson) is not { } release)
        {
            return new CommunityStatisticsAnswer(CommunityStatisticsResponse.NothingYet, row?.Id);
        }

        var baby = await babies.FindAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        var ageWeeks = CommunityDays.AgeWeeksOn(baby.BirthDate, CommunityDays.DayOf(timeProvider.GetUtcNow()));
        var view = CommunityServing.ViewFor(release, catalogProvider.Catalog, ageWeeks);
        return new CommunityStatisticsAnswer(view is null ? CommunityStatisticsResponse.NothingYet : CommunityStatisticsResponse.From(view), row.Id);
    }

    /// <summary>The release, or <c>null</c> for a row that cannot be read (the phase-1 placeholder rows, a damaged row): nothing is served from it.</summary>
    private static CommunityRelease? ReadRelease(string statisticsJson)
    {
        try
        {
            return CommunityReleaseJson.Parse(statisticsJson);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
