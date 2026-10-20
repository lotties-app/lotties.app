using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

internal sealed class EfBabyMembershipRepository(BabyRoutineDbContext context) : IBabyMembershipRepository
{
    public Task<BabyMember?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
        context.BabyMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(member => member.BabyId == babyId && member.UserId == userId, cancellationToken);
}
