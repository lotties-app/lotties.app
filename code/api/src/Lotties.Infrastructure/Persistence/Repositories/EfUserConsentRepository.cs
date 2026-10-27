using Lotties.Domain.Consents;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>The primary key <c>(user_id, kind)</c> decides two concurrent first grants (<see cref="TryAddAsync"/>).</remarks>
internal sealed class EfUserConsentRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IUserConsentRepository
{
    public Task<UserConsent?> FindAsync(Guid userId, ConsentKind kind, CancellationToken cancellationToken = default) =>
        context.UserConsents.SingleOrDefaultAsync(consent => consent.UserId == userId && consent.Kind == kind, cancellationToken);

    public async Task<IReadOnlyList<UserConsent>> ListAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.UserConsents.AsNoTracking().Where(consent => consent.UserId == userId).ToListAsync(cancellationToken);

    public async Task<string?> CoreVersionAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.UserConsents.AsNoTracking()
            .Where(consent => consent.UserId == userId && consent.Kind == ConsentKind.Core && consent.WithdrawnAt == null)
            .Select(consent => consent.Version)
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyDictionary<Guid, string>> CoreVersionsAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default) =>
        await context.UserConsents.AsNoTracking()
            .Where(consent => userIds.Contains(consent.UserId) && consent.Kind == ConsentKind.Core && consent.WithdrawnAt == null)
            .ToDictionaryAsync(consent => consent.UserId, consent => consent.Version, cancellationToken);

    public async Task<bool> TryAddAsync(UserConsent consent, UserConsentHistoryEntry entry, CancellationToken cancellationToken = default)
    {
        context.Add(consent);
        context.Add(entry);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(consent).State = EntityState.Detached;
            context.Entry(entry).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException)
        {
            context.Entry(consent).State = EntityState.Detached;
            context.Entry(entry).State = EntityState.Detached;
            throw;
        }
    }

    public void AddHistory(UserConsentHistoryEntry entry) => context.Add(entry);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
