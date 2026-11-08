using System.Linq.Expressions;
using Lotties.Domain.Appointments;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Domain.Vaccinations;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Stores.Moves;

/// <summary>
/// Which of a baby's records a move reads: all of them, or, for a copy into the owner's own database, every record but another
/// person's private notes (and the read marks of those notes): docs/design/24-export-import.md keeps another person's private note out
/// of anything handed to the owner.
/// </summary>
internal sealed record BabyRecordFilter(Guid BabyId, Guid? PrivateNotesOnlyOf)
{
    public static BabyRecordFilter All(Guid babyId) => new(babyId, null);
}

/// <summary>
/// A row's identity and change stamp for the move verification: the key (two parts for <c>note_reads</c>) and the times a change moves
/// (<c>updated_at</c>, the deletion time, or the only time the table has). Projected by the database, never a record's content.
/// </summary>
internal sealed class RowStamp
{
    public Guid Key { get; init; }

    public Guid SubKey { get; init; }

    public DateTimeOffset? ChangedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }
}

/// <summary>One of the 12 data tables as a move sees it (<see cref="DataPlaneTables"/>).</summary>
internal interface IDataPlaneTable
{
    /// <summary>The table name (counts in the digest and in tests; never logged with values).</summary>
    string Name { get; }

    Type EntityType { get; }

    Task<int> CountAsync(LottiesDataDbContext context, BabyRecordFilter filter, CancellationToken cancellationToken);

    /// <summary>One page of the baby's rows in key order, not tracked (offset paging: the source does not change while its writes are blocked).</summary>
    Task<IReadOnlyList<object>> PageAsync(LottiesDataDbContext context, BabyRecordFilter filter, int offset, int size, CancellationToken cancellationToken);

    Task<IReadOnlyList<RowStamp>> StampsAsync(LottiesDataDbContext context, BabyRecordFilter filter, CancellationToken cancellationToken);

    /// <summary>Deletes every row of the baby in the table (one statement).</summary>
    Task<int> WipeAsync(LottiesDataDbContext context, Guid babyId, CancellationToken cancellationToken);
}

internal sealed class DataPlaneTable<TEntity>(
    string name,
    Func<LottiesDataDbContext, BabyRecordFilter, IQueryable<TEntity>> rows,
    Func<IQueryable<TEntity>, IOrderedQueryable<TEntity>> inKeyOrder,
    Expression<Func<TEntity, RowStamp>> stamp) : IDataPlaneTable
    where TEntity : class
{
    public string Name => name;

    public Type EntityType => typeof(TEntity);

    public Task<int> CountAsync(LottiesDataDbContext context, BabyRecordFilter filter, CancellationToken cancellationToken) =>
        rows(context, filter).CountAsync(cancellationToken);

    public async Task<IReadOnlyList<object>> PageAsync(LottiesDataDbContext context, BabyRecordFilter filter, int offset, int size, CancellationToken cancellationToken) =>
        await inKeyOrder(rows(context, filter).AsNoTracking()).Skip(offset).Take(size).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<RowStamp>> StampsAsync(LottiesDataDbContext context, BabyRecordFilter filter, CancellationToken cancellationToken) =>
        await rows(context, filter).Select(stamp).ToListAsync(cancellationToken);

    public Task<int> WipeAsync(LottiesDataDbContext context, Guid babyId, CancellationToken cancellationToken) =>
        rows(context, BabyRecordFilter.All(babyId)).ExecuteDeleteAsync(cancellationToken);
}

/// <summary>
/// The 12 tables of the data plane (<see cref="DataPlane.EntityTypes"/>) in copy order: what other rows point at comes first
/// (<c>event_types</c> before <c>events</c>, <c>baby_notes</c> before <c>note_reads</c>, medications before prescriptions, providers
/// before appointments); deletes run in the reverse order. Built-in event types (no baby) are never copied: every store has them. Soft-
/// deleted rows are copied like the others (clients learn deletions from them). A new data table fails <c>DataPlaneTablesTests</c>
/// until it is listed here.
/// </summary>
internal static class DataPlaneTables
{
    public static readonly IReadOnlyList<IDataPlaneTable> InCopyOrder =
    [
        new DataPlaneTable<EventType>(
            "event_types",
            (context, filter) => context.EventTypes.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id }),
        new DataPlaneTable<Medication>(
            "medications",
            (context, filter) => context.Medications.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.CreatedAt }),
        new DataPlaneTable<Prescription>(
            "prescriptions",
            (context, filter) => context.Prescriptions.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt, DeletedAt = row.DeletedAt }),
        new DataPlaneTable<Formula>(
            "formulas",
            (context, filter) => context.Formulas.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt }),
        new DataPlaneTable<CareProvider>(
            "care_providers",
            (context, filter) => context.CareProviders.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt }),
        new DataPlaneTable<Appointment>(
            "appointments",
            (context, filter) => context.Appointments.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt }),
        new DataPlaneTable<Vaccination>(
            "vaccinations",
            (context, filter) => context.Vaccinations.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt, DeletedAt = row.DeletedAt }),
        new DataPlaneTable<Measurement>(
            "measurements",
            (context, filter) => context.Measurements.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt }),
        new DataPlaneTable<BabyNote>(
            "baby_notes",
            (context, filter) => NotesOf(context, filter),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt, DeletedAt = row.DeletedAt }),
        new DataPlaneTable<PrescriptionProposal>(
            "prescription_proposals",
            (context, filter) => context.PrescriptionProposals.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt }),
        new DataPlaneTable<NoteRead>(
            "note_reads",
            NoteReadsOf,
            query => query.OrderBy(row => row.NoteId).ThenBy(row => row.UserId),
            row => new RowStamp { Key = row.NoteId, SubKey = row.UserId, ChangedAt = row.ReadAt }),
        new DataPlaneTable<Event>(
            "events",
            (context, filter) => context.Events.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId),
            query => query.OrderBy(row => row.Id),
            row => new RowStamp { Key = row.Id, ChangedAt = row.UpdatedAt, DeletedAt = row.DeletedAt }),
    ];

    /// <summary>The read marks of the notes the filter lets through.</summary>
    private static IQueryable<NoteRead> NoteReadsOf(LottiesDataDbContext context, BabyRecordFilter filter)
    {
        var reads = context.NoteReads.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId);
        if (filter.PrivateNotesOnlyOf is null)
        {
            return reads;
        }

        var notes = NotesOf(context, filter);
        return reads.Where(row => notes.Any(note => note.Id == row.NoteId));
    }

    /// <summary>The baby's notes the filter lets through: all, or shared ones and the private ones of the one allowed author.</summary>
    private static IQueryable<BabyNote> NotesOf(LottiesDataDbContext context, BabyRecordFilter filter)
    {
        var notes = context.BabyNotes.IgnoreQueryFilters().Where(row => row.BabyId == filter.BabyId);
        return filter.PrivateNotesOnlyOf is { } author
            ? notes.Where(row => row.Visibility == NoteVisibility.Shared || row.AuthorUserId == author)
            : notes;
    }
}
