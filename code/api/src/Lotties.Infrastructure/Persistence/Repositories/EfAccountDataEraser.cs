using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notes;
using Lotties.Domain.Proposals;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <summary>
/// Account deletion in bulk. A baby with no other member is erased with everything under it. On a baby other people
/// keep, the membership, private notes, pending proposals, unaccepted invites and read marks of the user go; what she
/// wrote that the family uses (events, measurements, shared notes, decided proposals) stays, attributed to the
/// anonymized user row (<see cref="User.Anonymize"/>), because every such foreign key points at it. Project board rows
/// (items, history, API keys) stay too, with the link to her cleared and her name snapshot replaced by the stand-in.
/// Every column of the model that points at a baby or a user has a rule in <c>AccountErasureTests.Rules</c> (Lotties.Api.Tests):
/// a new one fails that test until it gets a rule here and a row in its fixture. Most foreign keys to <c>babies</c> are
/// <c>RESTRICT</c>, so a table missing below makes the deletion fail (on PostgreSQL and SQLite alike) instead of leaving rows.
/// The data tables are erased through the control context, which only the built-in database has (there they also hold the old
/// copy of a baby that moved into her own database during the undo window). A baby on an external store
/// (docs/design/47-bring-your-own-database.md section 9, task T10): with <see cref="ExternalStoreErasure.Refuse"/> (the demo cleanup)
/// every baby whose records are touched is entered in the <see cref="StoreScope"/> and must be on the built-in store, else the erasure
/// fails with <c>store_unavailable</c> and changes nothing; with <see cref="ExternalStoreErasure.LottiesSideOnly"/> (account deletion) a
/// baby erased with the account is erased here whatever its store, because <c>AccountDeletionService</c> already deleted its records in
/// her own database when she asked for it (<see cref="FindOwnStoreCopiesAsync"/> names them), and only the babies that stay for other
/// members must be on the built-in store. Her <c>data_stores</c> rows (sealed descriptors) go with her personal records in every case,
/// and an erased baby's <c>data_store_moves</c> row goes with the baby. The eraser never opens an external store itself.
/// No table holds anonymous aggregates derived from babies today (no statistics or insights table exists); a future one is kept on
/// deletion only if it holds no identifier and cannot be traced back to a baby or an account, and needs a rule saying so in
/// <c>AccountErasureTests.Rules</c> (design 47 section 9).
/// </summary>
internal sealed class EfAccountDataEraser(LottiesDbContext context, StoreScope stores) : IAccountDataEraser
{
    public async Task<AccountDeletionPlan> PlanAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var mine = await context.BabyMembers.AsNoTracking()
            .Where(member => member.UserId == userId)
            .Join(context.Babies.AsNoTracking(), member => member.BabyId, baby => baby.Id, (member, baby) => new { baby.Id, baby.Name, baby.Label, member.Role })
            .OrderBy(row => row.Name)
            .ToListAsync(cancellationToken);
        IReadOnlyCollection<Guid> babyIds = [.. mine.Select(row => row.Id)];
        var others = await context.BabyMembers.AsNoTracking()
            .Where(member => babyIds.Contains(member.BabyId) && member.UserId != userId)
            .Select(member => new { member.BabyId, member.Role })
            .ToListAsync(cancellationToken);

        var deleted = new List<AccountDeletionBaby>();
        var left = new List<AccountDeletionBaby>();
        var blocked = new List<AccountDeletionBaby>();
        foreach (var row in mine)
        {
            var baby = new AccountDeletionBaby(row.Id, row.Name.Length > 0 ? row.Name : BabyLabels.Shown(BabyLabels.Normalize(row.Label)));
            var rest = others.Where(other => other.BabyId == row.Id).ToList();
            if (rest.Count == 0)
            {
                deleted.Add(baby);
            }
            else if (row.Role == BabyRole.Owner && rest.All(other => other.Role != BabyRole.Owner))
            {
                blocked.Add(baby);
            }
            else
            {
                left.Add(baby);
            }
        }

        return new AccountDeletionPlan(deleted, left, blocked);
    }

    public async Task<OwnStoreCopies> FindOwnStoreCopiesAsync(Guid userId, IReadOnlyCollection<Guid> babyIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(babyIds);
        var storeIds = await context.DataStores.AsNoTracking().Where(store => store.OwnerUserId == userId).Select(store => store.Id).ToListAsync(cancellationToken);
        var pointers = await context.BabyStoreAssignments.AsNoTracking()
            .Where(row => babyIds.Contains(row.BabyId) && row.DataStoreId != null)
            .Select(row => new OwnStoreCopy(row.BabyId, row.DataStoreId!.Value))
            .ToListAsync(cancellationToken);
        var moves = await context.DataStoreMoves.AsNoTracking().Where(row => babyIds.Contains(row.BabyId)).ToListAsync(cancellationToken);
        var leftovers = moves
            .Where(move => move.OwnStoreThatMayHoldRecords is not null)
            .Select(move => new OwnStoreCopy(move.BabyId, move.OwnStoreThatMayHoldRecords!.Value));
        IReadOnlyList<OwnStoreCopy> copies = [.. pointers.Concat(leftovers).Where(copy => storeIds.Contains(copy.StoreId)).Distinct()];
        return new OwnStoreCopies(copies, storeIds);
    }

    /// <remarks>
    /// On PostgreSQL the update takes the babies' row locks: a move start that holds one is waited for, and the check that follows (a
    /// new statement, so a new snapshot) then sees its committed move row; a move start that comes after waits for this transaction
    /// and then matches nothing (<c>IDataStoreMoveRepository.TrySaveUnlessDeletingAsync</c>). A stale block (older than
    /// <c>AccountDeletionBlock.MaxAge</c>) is taken over.
    /// </remarks>
    public async Task BeginDeletionAsync(IReadOnlyCollection<Guid> babyIds, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(babyIds);
        if (babyIds.Count == 0)
        {
            return;
        }

        var staleBefore = AccountDeletionBlock.StaleBefore(now);
        DateTimeOffset? startedAt = now.ToUniversalTime();
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        var blocked = await context.BabyStoreAssignments
            .Where(row => babyIds.Contains(row.BabyId) && (row.AccountDeletionStartedAt == null || row.AccountDeletionStartedAt <= staleBefore))
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.AccountDeletionStartedAt, startedAt), cancellationToken);
        EnsureAllBlocked(blocked, babyIds.Count);
        await EnsureNoMoveRunningAsync(babyIds, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task CancelDeletionAsync(IReadOnlyCollection<Guid> babyIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(babyIds);
        await context.BabyStoreAssignments
            .Where(row => babyIds.Contains(row.BabyId))
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.AccountDeletionStartedAt, (DateTimeOffset?)null), cancellationToken);
    }

    private static void EnsureAllBlocked(int blocked, int babies)
    {
        if (blocked != babies)
        {
            throw new AccountDeletionInProgressException();
        }
    }

    /// <summary>A move whose worker holds the row (copying, verifying, or deleting an old copy or leftovers) refuses the deletion.</summary>
    private async Task EnsureNoMoveRunningAsync(IReadOnlyCollection<Guid> babyIds, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var at = now.ToUniversalTime();
        if (await context.DataStoreMoves.AnyAsync(move => babyIds.Contains(move.BabyId) && move.LeaseUntil != null && move.LeaseUntil > at, cancellationToken))
        {
            throw new DataStoreMoveInProgressException();
        }
    }

    public async Task EraseAsync(Guid userId, string anonymousName, DateTimeOffset now, ExternalStoreErasure externalStores, CancellationToken cancellationToken = default)
    {
        var plan = await PlanAsync(userId, cancellationToken);
        plan.EnsureNotBlocked();
        await stores.RequireBuiltInAsync(BabiesThatMustBeBuiltIn(plan, externalStores), cancellationToken);
        var user = await context.Users.SingleAsync(candidate => candidate.Id == userId, cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        await DeleteBabiesAsync([.. plan.Deleted.Select(baby => baby.Id)], cancellationToken);
        await LeaveBabiesAsync(userId, cancellationToken);
        await DeletePersonalRecordsAsync(userId, anonymousName, cancellationToken);
        user.Anonymize(anonymousName, now);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>The babies whose records the erasure reaches through the control context only, so they must be on the built-in store.</summary>
    private static IReadOnlyList<Guid> BabiesThatMustBeBuiltIn(AccountDeletionPlan plan, ExternalStoreErasure externalStores) =>
        externalStores == ExternalStoreErasure.Refuse
            ? [.. plan.DeletedIds, .. plan.Left.Select(baby => baby.Id)]
            : [.. plan.Left.Select(baby => baby.Id)];

    private async Task DeleteBabiesAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
        {
            return;
        }

        await context.NoteReads.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.BabyNotes.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.PrescriptionProposals.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.AccessLog.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Appointments.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.CareProviders.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Vaccinations.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Formulas.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Measurements.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Events.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Prescriptions.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.Medications.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.EventTypes.IgnoreQueryFilters().Where(row => row.BabyId != null && ids.Contains(row.BabyId.Value)).ExecuteDeleteAsync(cancellationToken);
        await context.Invites.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.NotificationActions.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.NotificationDeliveries.IgnoreQueryFilters().Where(row => row.BabyId != null && ids.Contains(row.BabyId.Value)).ExecuteDeleteAsync(cancellationToken);
        await context.BabyNotificationPreferences.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.DataStoreMoves.Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        // The community insights consent lines go with the erased baby (design 34 section 3.2; keeping a hashed proof is open decision O8).
        await context.CommunityConsents.Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.BabyMembers.IgnoreQueryFilters().Where(row => ids.Contains(row.BabyId)).ExecuteDeleteAsync(cancellationToken);
        await context.UserAssistantSettings
            .Where(row => row.DefaultBabyId != null && ids.Contains(row.DefaultBabyId.Value))
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.DefaultBabyId, (Guid?)null), cancellationToken);
        await RemoveBabyRowsAsync(ids, cancellationToken);
    }

    /// <summary>
    /// The baby rows themselves, through the change tracker (one statement per baby): table <c>babies</c> also holds the routing
    /// columns (<c>BabyStoreAssignment</c>, table splitting), and EF Core does not bulk-delete a table two entity types share.
    /// </summary>
    private async Task RemoveBabyRowsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
    {
        context.Babies.RemoveRange(await context.Babies.IgnoreQueryFilters().Where(row => ids.Contains(row.Id)).ToListAsync(cancellationToken));
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>The memberships of the user on babies that stay (the babies she was alone in are already gone).</summary>
    private async Task LeaveBabiesAsync(Guid userId, CancellationToken cancellationToken)
    {
        await context.NoteReads.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.BabyNotes.IgnoreQueryFilters()
            .Where(note => note.AuthorUserId == userId && note.Visibility == NoteVisibility.Private)
            .ExecuteDeleteAsync(cancellationToken);
        await context.PrescriptionProposals.IgnoreQueryFilters()
            .Where(proposal => proposal.AuthorUserId == userId && proposal.Status == ProposalStatus.Pending)
            .ExecuteDeleteAsync(cancellationToken);
        await context.Invites.IgnoreQueryFilters().Where(invite => invite.CreatedBy == userId && invite.AcceptedAt == null).ExecuteDeleteAsync(cancellationToken);
        await context.BabyNotificationPreferences.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.BabyMembers.IgnoreQueryFilters().Where(member => member.UserId == userId).ExecuteDeleteAsync(cancellationToken);
    }

    private async Task DeletePersonalRecordsAsync(Guid userId, string anonymousName, CancellationToken cancellationToken)
    {
        await context.NotificationDeliveries.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.NotificationActions.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.PushSubscriptions.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserNotificationSettings.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.ProfessionalProfiles.IgnoreQueryFilters().Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserAssistantSettings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserUnitSettings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserFeedingSettings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserRestSettings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserRestMornings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserConsents.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserConsentHistory.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);

        // Her external data stores (sealed descriptors): after her babies are gone, so no erased baby still points at one.
        await context.DataStores.Where(row => row.OwnerUserId == userId).ExecuteDeleteAsync(cancellationToken);

        // Catalog products she added stay for everyone (instance-wide), without the link to her.
        await context.Products.IgnoreQueryFilters()
            .Where(row => row.CreatedBy == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.CreatedBy, (Guid?)null), cancellationToken);
        await AnonymizeBoardAsync(userId, anonymousName, cancellationToken);
    }

    /// <summary>
    /// The project board (docs/design/36 section 8) is the project's, not hers: its items, history and API keys stay, without
    /// the link to her and with the stand-in name instead of her display name snapshot.
    /// </summary>
    private async Task AnonymizeBoardAsync(Guid userId, string anonymousName, CancellationToken cancellationToken)
    {
        await context.BoardItems
            .Where(row => row.CreatedByUserId == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.CreatedByUserId, (Guid?)null).SetProperty(row => row.CreatedByName, anonymousName), cancellationToken);
        await context.BoardItemEvents
            .Where(row => row.ActorUserId == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.ActorUserId, (Guid?)null).SetProperty(row => row.ActorName, anonymousName), cancellationToken);
        await context.BoardApiKeys
            .Where(row => row.CreatedByUserId == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.CreatedByUserId, (Guid?)null).SetProperty(row => row.CreatedByName, anonymousName), cancellationToken);
    }
}
