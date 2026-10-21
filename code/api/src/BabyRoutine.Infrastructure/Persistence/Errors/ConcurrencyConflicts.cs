using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace BabyRoutine.Infrastructure.Persistence.Errors;

/// <summary>
/// Turns a lost optimistic-concurrency race (<see cref="DbUpdateConcurrencyException"/>, see
/// <see cref="Configurations.RowVersions"/>) into the domain outcome the caller would have seen had it run second:
/// an invite another request accepted first is <see cref="InviteAlreadyAcceptedException"/>, one revoked meanwhile
/// <see cref="InviteNotFoundException"/>; anything else (e.g. the baby's members changed) is
/// <see cref="ConcurrentModificationException"/>, which is safe to retry.
/// </summary>
internal static class ConcurrencyConflicts
{
    public static async Task<DomainException> TranslateAsync(DbUpdateConcurrencyException exception, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var inviteEntry = exception.Entries.FirstOrDefault(entry => entry.Entity is Invite);
        return inviteEntry is null
            ? new ConcurrentModificationException(ResourceOf(exception), exception)
            : await InviteConflictAsync(inviteEntry, exception, cancellationToken);
    }

    private static async Task<DomainException> InviteConflictAsync(EntityEntry entry, DbUpdateConcurrencyException exception, CancellationToken cancellationToken)
    {
        var invite = (Invite)entry.Entity;
        var stored = await entry.GetDatabaseValuesAsync(cancellationToken);
        return stored switch
        {
            null => new InviteNotFoundException(),
            _ when stored[nameof(Invite.AcceptedAt)] is not null => new InviteAlreadyAcceptedException(invite.Id),
            _ => new ConcurrentModificationException("invite", exception),
        };
    }

    private static string ResourceOf(DbUpdateConcurrencyException exception) =>
        exception.Entries.Any(entry => entry.Entity is Baby or BabyMember) ? "baby" : "record";
}
