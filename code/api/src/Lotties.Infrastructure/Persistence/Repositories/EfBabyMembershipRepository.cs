using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

internal sealed class EfBabyMembershipRepository(LottiesDbContext context) : IBabyMembershipRepository
{
    public Task<BabyMember?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
        context.BabyMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(member => member.BabyId == babyId && member.UserId == userId, cancellationToken);
}
