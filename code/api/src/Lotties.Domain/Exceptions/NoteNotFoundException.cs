namespace Lotties.Domain.Exceptions;

/// <summary>
/// No note with the id exists for the baby, or it is a private note of another author (which is never revealed: the
/// same answer as an unknown id).
/// </summary>
public sealed class NoteNotFoundException : DomainException
{
    public NoteNotFoundException(Guid babyId, Guid noteId)
        : base("note_not_found", $"Note {noteId} was not found for baby {babyId}.")
    {
        BabyId = babyId;
        NoteId = noteId;
    }

    public Guid BabyId { get; }

    public Guid NoteId { get; }
}
