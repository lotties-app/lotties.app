using Lotties.Domain.Professionals;
using Lotties.Domain.Users;

namespace Lotties.Application.Professionals;

/// <summary>Names the people on a baby's data the way the family sees them (<see cref="PersonSummary"/>).</summary>
public interface IPersonDirectory
{
    /// <summary>One summary per known user id (unknown ids are skipped).</summary>
    Task<IReadOnlyDictionary<Guid, PersonSummary>> DescribeAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);
}

internal sealed class PersonDirectory(IUserRepository users, IProfessionalProfileRepository profiles) : IPersonDirectory
{
    public async Task<IReadOnlyDictionary<Guid, PersonSummary>> DescribeAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
        {
            return new Dictionary<Guid, PersonSummary>();
        }

        var distinct = userIds.Distinct().ToArray();
        var known = await users.FindByIdsAsync(distinct, cancellationToken);
        var professionals = (await profiles.FindManyAsync(distinct, cancellationToken)).ToDictionary(profile => profile.UserId);
        return known.ToDictionary(user => user.Id, user => Describe(user, professionals.GetValueOrDefault(user.Id)));
    }

    private static PersonSummary Describe(User user, ProfessionalProfile? profile) => new()
    {
        UserId = user.Id,
        DisplayName = profile is null ? user.DisplayName : (profile.ShareDisplayName ? profile.DisplayName : string.Empty),
        RoleLabel = user.RoleLabel,
        Professional = profile is null ? null : (ProfessionalSummary)profile,
    };
}
