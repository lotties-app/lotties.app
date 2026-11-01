namespace Lotties.Domain.Exceptions;

/// <summary>A note can be edited or deleted only by its author; this shared note was written by another member.</summary>
public sealed class NoteNotOwnedException : DomainException
{
    public NoteNotOwnedException(Guid noteId, Guid userId)
        : base("note_not_owned", $"Note {noteId} was written by another member; only its author edits or deletes it.")
    {
        NoteId = noteId;
        UserId = userId;
    }

    public Guid NoteId { get; }

    public Guid UserId { get; }
}
