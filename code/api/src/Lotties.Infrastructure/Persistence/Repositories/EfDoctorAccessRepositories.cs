using Lotties.Domain.AccessLogs;
using Lotties.Domain.Notes;
using Lotties.Domain.Professionals;
using Lotties.Infrastructure.Persistence.Errors;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>A concurrent first save of one user's profile loses on the primary key (<see cref="UniqueInserts"/>).</remarks>
internal sealed class EfProfessionalProfileRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IProfessionalProfileRepository
{
    public Task<ProfessionalProfile?> FindAsync(Guid userId, CancellationToken cancellationToken = default) =>
        context.ProfessionalProfiles.SingleOrDefaultAsync(profile => profile.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<ProfessionalProfile>> FindManyAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        return await context.ProfessionalProfiles.AsNoTracking().Where(profile => userIds.Contains(profile.UserId)).ToListAsync(cancellationToken);
    }

    public Task<bool> TryAddAsync(ProfessionalProfile profile, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, profile, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}

/// <remarks>
/// Visibility is part of every list query (<c>visibility = 'shared' OR author_user_id = reader</c>), so a private note
/// never leaves the database for anyone but its author. A concurrent create of one id loses on the primary key.
/// </remarks>
internal sealed class EfNoteRepository(StoreScope stores, UniqueViolations uniqueViolations) : INoteRepository
{
    public Task<BabyNote?> FindAsync(Guid noteId, CancellationToken cancellationToken = default) =>
        stores.Current.BabyNotes.SingleOrDefaultAsync(note => note.Id == noteId, cancellationToken);

    public async Task<IReadOnlyList<BabyNote>> ListChangesVisibleToAsync(Guid babyId, Guid readerUserId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var visible = stores.ContextFor(babyId).BabyNotes
            .AsNoTracking()
            .Where(note => note.BabyId == babyId)
            .Where(note => note.Visibility == NoteVisibility.Shared || note.AuthorUserId == readerUserId);
        var changed = since is { } from ? visible.Where(note => note.UpdatedAt >= from.ToUniversalTime()) : visible;
        return await changed.OrderBy(note => note.UpdatedAt).ThenBy(note => note.Id).ToListAsync(cancellationToken);
    }

    public Task<int> CountSharedByAuthorAsync(Guid babyId, Guid authorUserId, CancellationToken cancellationToken = default) =>
        stores.ContextFor(babyId).BabyNotes.CountAsync(
            note => note.BabyId == babyId && note.AuthorUserId == authorUserId && note.Visibility == NoteVisibility.Shared && note.DeletedAt == null,
            cancellationToken);

    public Task<bool> TryAddAsync(BabyNote note, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(note);
        return UniqueInserts.TryInsertAsync(stores.ContextFor(note.BabyId), uniqueViolations, note, cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => stores.Current.SaveChangesAsync(cancellationToken);
}

/// <remarks>
/// Requests of one doctor that race after reading the same latest entry write the same id (derived from it): every
/// insert but the first loses on the primary key.
/// </remarks>
internal sealed class EfAccessLogRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IAccessLogRepository
{
    public Task<AccessLogEntry?> FindLatestAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
        context.AccessLog
            .AsNoTracking()
            .Where(entry => entry.BabyId == babyId && entry.UserId == userId)
            .OrderByDescending(entry => entry.At)
            .ThenBy(entry => entry.Id)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<AccessLogEntry>> ListNewestAsync(Guid babyId, int limit, CancellationToken cancellationToken = default) =>
        await context.AccessLog
            .AsNoTracking()
            .Where(entry => entry.BabyId == babyId)
            .OrderByDescending(entry => entry.At)
            .ThenBy(entry => entry.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public Task<bool> TryAddAsync(AccessLogEntry entry, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, entry, cancellationToken);
}
