using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

internal sealed class EfBabyRepository(BabyRoutineDbContext context) : IBabyRepository
{
    public async Task<IReadOnlyList<Baby>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.Babies
            .AsNoTracking()
            .Include(baby => baby.Members)
            .Where(baby => baby.Members.Any(member => member.UserId == userId))
            .OrderBy(baby => baby.Name)
            .ThenBy(baby => baby.Id)
            .ToListAsync(cancellationToken);

    public Task<Baby?> FindAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        context.Babies.Include(baby => baby.Members).SingleOrDefaultAsync(baby => baby.Id == babyId, cancellationToken);

    public async Task AddAsync(Baby baby, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(baby);
        context.Babies.Add(baby);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
