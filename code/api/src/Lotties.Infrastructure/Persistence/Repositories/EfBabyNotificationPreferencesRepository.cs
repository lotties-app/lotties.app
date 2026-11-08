using Lotties.Application.Notifications;
using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notes;
using Lotties.Domain.Notifications;
using Lotties.Domain.Proposals;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Candidates join the stored preferences with the current membership (a member removed since has no row: the
/// foreign key cascades) and an active subscription. Appointment reminders are on by default, so a member who never
/// stored preferences is a candidate too, with <see cref="ReminderPreferences.Default"/>, while the baby has an
/// upcoming appointment within the reminder horizon (a stored row with only appointment reminders on likewise). Who may
/// receive is decided by the domain rule <see cref="NotificationRules.CanReceive"/> after loading, so a member demoted to
/// Viewer is left out. Doctor suggestions (off by default) make a stored row a candidate while the baby has a pending
/// proposal or a shared recommendation created in the last 24 hours. Cry monitor alerts (off by default) make a stored row a
/// candidate while the baby has a fussy spell, not deleted, started within the stale cutoff (the monitor marks are read later).
/// A baby whose pointer names an external store is never a candidate (no reminders for a family's own database in the first
/// version, docs/design/47-bring-your-own-database.md D9, task T11), so the <c>EXISTS</c> tests on data tables only ever look at
/// babies whose records are in this database.
/// </remarks>
internal sealed class EfBabyNotificationPreferencesRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IBabyNotificationPreferencesRepository
{
    public Task<BabyNotificationPreferences?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
        context.BabyNotificationPreferences.SingleOrDefaultAsync(preferences => preferences.BabyId == babyId && preferences.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<BabyNotificationPreferences>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.BabyNotificationPreferences
            .AsNoTracking()
            .Where(preferences => preferences.UserId == userId)
            .OrderBy(preferences => preferences.BabyId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<NotificationCandidate>> ListCandidatesAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var stored = await CandidatesQuery(context, now).ToListAsync(cancellationToken);
        var defaults = await DefaultCandidatesQuery(context, now).ToListAsync(cancellationToken);
        return stored
            .Select(row => new NotificationCandidate(row.Preferences.BabyId, row.Preferences.UserId, row.Role, row.Preferences.Preferences))
            .Concat(defaults.Select(row => new NotificationCandidate(row.BabyId, row.UserId, row.Role, ReminderPreferences.Default)))
            .Where(candidate => NotificationRules.CanReceive(candidate.Role))
            .OrderBy(candidate => candidate.BabyId)
            .ThenBy(candidate => candidate.UserId)
            .ToArray();
    }

    public Task<bool> TryAddAsync(BabyNotificationPreferences preferences, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, preferences, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    /// <summary>The stored candidate rows before the role rule; exposed for SQL translation tests.</summary>
    internal static IQueryable<CandidateRow> CandidatesQuery(LottiesDbContext context, DateTimeOffset now)
    {
        var horizon = now + NotificationRules.AppointmentReminderHorizon;
        var suggestionsSince = now - NotificationRules.DoctorSuggestionLifetime;
        var crySince = now - NotificationRules.CryDetectedStaleCutoff;
        return from preferences in context.BabyNotificationPreferences.AsNoTracking()
            join member in context.BabyMembers.AsNoTracking()
                on new { preferences.BabyId, preferences.UserId } equals new { member.BabyId, member.UserId }
            where !context.BabyStoreAssignments.Any(assignment => assignment.BabyId == preferences.BabyId && assignment.DataStoreId != null)
            where (preferences.DoseDue || preferences.NapWindow || preferences.BellyPainPattern || preferences.OvertiredWarning || preferences.FussyPattern
                    || preferences.DiaperWetHeadsUp || preferences.DiaperDirtyHeadsUp || preferences.VaccineReminders
                    || (preferences.AppointmentReminders && context.Appointments.Any(appointment =>
                        appointment.BabyId == preferences.BabyId
                        && appointment.Status == AppointmentStatus.Upcoming
                        && appointment.StartsAt > now
                        && appointment.StartsAt <= horizon))
                    || (preferences.DoctorSuggestions
                        && (context.PrescriptionProposals.Any(proposal =>
                                proposal.BabyId == preferences.BabyId
                                && proposal.Status == ProposalStatus.Pending
                                && proposal.CreatedAt >= suggestionsSince)
                            || context.BabyNotes.Any(note =>
                                note.BabyId == preferences.BabyId
                                && note.Kind == NoteKind.Recommendation
                                && note.Visibility == NoteVisibility.Shared
                                && note.DeletedAt == null
                                && note.CreatedAt >= suggestionsSince)))
                    || (preferences.CryDetected && context.Events.Any(item =>
                        item.BabyId == preferences.BabyId
                        && item.TypeId == BuiltInEventTypes.FussyId
                        && item.DeletedAt == null
                        && item.StartedAt >= crySince)))
                && context.PushSubscriptions.Any(subscription =>
                    subscription.UserId == preferences.UserId
                    && subscription.RevokedAt == null
                    && (subscription.ExpiresAt == null || subscription.ExpiresAt > now))
            orderby preferences.BabyId, preferences.UserId
            select new CandidateRow(preferences, member.Role);
    }

    /// <summary>
    /// Members without stored preferences (appointment reminders on by default) whose baby has an upcoming appointment
    /// within the reminder horizon and who have an active subscription; before the role rule.
    /// </summary>
    internal static IQueryable<DefaultCandidateRow> DefaultCandidatesQuery(LottiesDbContext context, DateTimeOffset now)
    {
        var horizon = now + NotificationRules.AppointmentReminderHorizon;
        return from member in context.BabyMembers.AsNoTracking()
            where !context.BabyNotificationPreferences.Any(preferences => preferences.BabyId == member.BabyId && preferences.UserId == member.UserId)
                && !context.BabyStoreAssignments.Any(assignment => assignment.BabyId == member.BabyId && assignment.DataStoreId != null)
                && context.Appointments.Any(appointment =>
                    appointment.BabyId == member.BabyId
                    && appointment.Status == AppointmentStatus.Upcoming
                    && appointment.StartsAt > now
                    && appointment.StartsAt <= horizon)
                && context.PushSubscriptions.Any(subscription =>
                    subscription.UserId == member.UserId
                    && subscription.RevokedAt == null
                    && (subscription.ExpiresAt == null || subscription.ExpiresAt > now))
            orderby member.BabyId, member.UserId
            select new DefaultCandidateRow(member.BabyId, member.UserId, member.Role);
    }

    internal sealed record CandidateRow(BabyNotificationPreferences Preferences, BabyRole Role);

    internal sealed record DefaultCandidateRow(Guid BabyId, Guid UserId, BabyRole Role);
}
