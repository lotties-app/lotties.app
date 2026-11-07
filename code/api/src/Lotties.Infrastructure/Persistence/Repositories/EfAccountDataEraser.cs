using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notes;
using Lotties.Domain.Proposals;
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
/// The data tables are erased through the control context, which only the built-in database has: before anything is deleted,
/// every baby whose records are touched is entered in the <see cref="StoreScope"/> and must be on the built-in store, else the
/// erasure fails with <c>store_unavailable</c> and changes nothing (a family's own database is erased by task T10). Her
/// <c>data_stores</c> rows go with her personal records (docs/design/47-bring-your-own-database.md section 9).
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

    public async Task EraseAsync(Guid userId, string anonymousName, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var plan = await PlanAsync(userId, cancellationToken);
        if (plan.Blocked.Count > 0)
        {
            throw new AccountDeletionBlockedException([.. plan.Blocked.Select(baby => baby.Id)]);
        }

        await stores.RequireBuiltInAsync([.. plan.Deleted.Select(baby => baby.Id), .. plan.Left.Select(baby => baby.Id)], cancellationToken);
        var user = await context.Users.SingleAsync(candidate => candidate.Id == userId, cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        await DeleteBabiesAsync([.. plan.Deleted.Select(baby => baby.Id)], cancellationToken);
        await LeaveBabiesAsync(userId, cancellationToken);
        await DeletePersonalRecordsAsync(userId, anonymousName, cancellationToken);
        user.Anonymize(anonymousName, now);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

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
