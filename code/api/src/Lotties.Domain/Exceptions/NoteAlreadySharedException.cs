namespace Lotties.Domain.Exceptions;

/// <summary>
/// A shared note cannot become private again: the other members already have it on their devices, and a private note
/// is never sent to them, so they could not learn the change. The author deletes it instead (a delete reaches everyone).
/// </summary>
public sealed class NoteAlreadySharedException : DomainException
{
    public NoteAlreadySharedException(Guid noteId)
        : base("note_already_shared", $"Note {noteId} is shared with the baby's members and cannot be made private; delete it instead.")
    {
        NoteId = noteId;
    }

    public Guid NoteId { get; }
}
