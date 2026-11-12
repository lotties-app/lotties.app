using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Lotties.Infrastructure.Persistence.Errors;

/// <summary>
/// Turns a lost optimistic-concurrency race (<see cref="DbUpdateConcurrencyException"/>, see
/// <see cref="Configurations.RowVersions"/>) into the domain outcome the caller would have seen had it run second:
/// an invite another request accepted first is <see cref="InviteAlreadyAcceptedException"/>, one revoked meanwhile
/// <see cref="InviteNotFoundException"/>; anything else (e.g. the baby's members changed) is
/// <see cref="ConcurrentModificationException"/>, which is safe to retry.
/// </summary>
/// <remarks>
/// The invite being saved decides the outcome even when another row failed first: the provider reports only the first failing
/// entry, and accepting an invite also rewrites the baby row (its members changed), which EF may write before the invite. So an
/// invite pending a write in the same unit of work is checked too, and a baby-row conflict stays
/// <see cref="ConcurrentModificationException"/> only while that invite is still unaccepted.
/// </remarks>
internal static class ConcurrencyConflicts
{
    public static async Task<DomainException> TranslateAsync(DbUpdateConcurrencyException exception, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var inviteEntry = exception.Entries.FirstOrDefault(entry => entry.Entity is Invite) ?? PendingInviteOf(exception);
        var inviteOutcome = inviteEntry is null ? null : await InviteOutcomeAsync(inviteEntry, cancellationToken);
        return inviteOutcome ?? new ConcurrentModificationException(ResourceOf(exception), exception);
    }

    /// <summary>An invite of the failed save's unit of work that was being changed or removed, though it was not the entry that failed.</summary>
    private static EntityEntry? PendingInviteOf(DbUpdateConcurrencyException exception) =>
        exception.Entries
            .Select(entry => entry.Context)
            .Distinct()
            .SelectMany(context => context.ChangeTracker.Entries<Invite>())
            .FirstOrDefault(entry => entry.State is EntityState.Modified or EntityState.Deleted);

    /// <summary>The invite's own outcome, or null when it is still pending (the conflict is then about another row).</summary>
    private static async Task<DomainException?> InviteOutcomeAsync(EntityEntry entry, CancellationToken cancellationToken)
    {
        var invite = (Invite)entry.Entity;
        var stored = await entry.GetDatabaseValuesAsync(cancellationToken);
        return stored switch
        {
            null => new InviteNotFoundException(),
            _ when stored[nameof(Invite.AcceptedAt)] is not null => new InviteAlreadyAcceptedException(invite.Id),
            _ => null,
        };
    }

    private static string ResourceOf(DbUpdateConcurrencyException exception) =>
        exception.Entries switch
        {
            var entries when entries.Any(entry => entry.Entity is Invite) => "invite",
            var entries when entries.Any(entry => entry.Entity is Baby or BabyMember) => "baby",
            _ => "record",
        };
}
