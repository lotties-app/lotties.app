using BabyRoutine.Domain.Babies;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <see cref="SaveChangesAsync"/> treats a baby and its members as one aggregate: when members were added, changed or
/// removed, the baby row is rewritten too, so its <c>xmin</c> row version is checked and bumped and two concurrent
/// member changes cannot both pass a rule such as "a baby keeps an owner". A lost race becomes a domain exception
/// (<see cref="ConcurrencyConflicts"/>).
/// </remarks>
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

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        TouchBabiesWithChangedMembers();
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw await ConcurrencyConflicts.TranslateAsync(exception, cancellationToken);
        }
    }

    /// <summary>Marks unchanged tracked babies whose members changed as modified, so their row (and row version) is written.</summary>
    private void TouchBabiesWithChangedMembers()
    {
        var changedBabyIds = context.ChangeTracker.Entries<BabyMember>()
            .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(entry => entry.Entity.BabyId)
            .ToHashSet();
        var untouched = context.ChangeTracker.Entries<Baby>()
            .Where(entry => entry.State == EntityState.Unchanged && changedBabyIds.Contains(entry.Entity.Id))
            .ToArray();
        foreach (var baby in untouched)
        {
            baby.Property(item => item.Name).IsModified = true;
        }
    }
}
