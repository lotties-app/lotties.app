using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Babies;

/// <summary>The current user's <see cref="SectionView"/> of a baby, from the membership the request already loaded.</summary>
internal static class SectionViews
{
    /// <summary>The caller's view of <paramref name="babyId"/>; a caller who is not a member is <see cref="BabyNotFoundException"/>.</summary>
    public static async Task<SectionView> ViewOfCallerAsync(this IBabyAccessService access, Guid babyId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(access);
        var member = await access.FindMembershipAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        return SectionView.Of(member);
    }
}
