using System.Text.Json.Serialization;
using Lotties.Application.Professionals;
using Lotties.Application.Serialization;
using Lotties.Domain.Notes;

namespace Lotties.Application.Notes;

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/notes/{noteId}</c>: the full editable state. <c>kind</c> defaults to
/// <c>note</c>, <c>visibility</c> to <c>shared</c>; <c>body</c> is required. <c>updatedAt</c> is the client edit time
/// (last write wins, as for events).
/// </summary>
public sealed record UpsertNoteRequest
{
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public NoteKind? Kind { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public NoteVisibility? Visibility { get; init; }

    public string? Body { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule; throws <see cref="Domain.Exceptions.DomainValidationException"/> naming the field.</summary>
    public static explicit operator NoteTerms(UpsertNoteRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return NoteTerms.Create(request.Kind ?? NoteKind.Note, request.Visibility ?? NoteVisibility.Shared, request.Body);
    }
}

/// <summary>A note as stored, with its author as the family sees her.</summary>
public sealed record NoteResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public Guid AuthorUserId { get; init; }

    /// <summary>The author's name and professional details at the time of the read (<c>null</c> if the account is gone).</summary>
    public PersonSummary? Author { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public NoteKind Kind { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public NoteVisibility Visibility { get; init; }

    public required string Body { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Client edit time of the last applied change; decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public static NoteResponse For(BabyNote note, PersonSummary? author)
    {
        ArgumentNullException.ThrowIfNull(note);
        return new NoteResponse
        {
            Id = note.Id,
            BabyId = note.BabyId,
            AuthorUserId = note.AuthorUserId,
            Author = author,
            Kind = note.Kind,
            Visibility = note.Visibility,
            Body = note.Body,
            CreatedAt = note.CreatedAt,
            UpdatedAt = note.UpdatedAt,
            ClientUpdatedAt = note.ClientUpdatedAt,
            DeletedAt = note.DeletedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the note as stored, and whether this request created it.</summary>
public sealed record UpsertNoteResult(NoteResponse Note, bool Created);

/// <summary>That the caller opened a note: <c>{noteId, readAt}</c> (server time of the first read; the delta cursor of her reads).</summary>
public sealed record NoteReadResponse
{
    public Guid NoteId { get; init; }

    public DateTimeOffset ReadAt { get; init; }

    public static implicit operator NoteReadResponse(NoteRead read)
    {
        ArgumentNullException.ThrowIfNull(read);
        return new NoteReadResponse { NoteId = read.NoteId, ReadAt = read.ReadAt };
    }
}
