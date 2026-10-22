namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing note through a baby it does not belong to.</summary>
public sealed class NoteBabyMismatchException : DomainException
{
    public NoteBabyMismatchException(Guid noteId, Guid requestedBabyId)
        : base("note_baby_mismatch", $"Note {noteId} does not belong to baby {requestedBabyId}; a note cannot change baby.")
    {
        NoteId = noteId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid NoteId { get; }

    public Guid RequestedBabyId { get; }
}
