namespace Lotties.Domain.Babies;

/// <summary>A member's role on a baby. Stored and sent by name, never by number.</summary>
public enum BabyRole
{
    /// <summary>Full control, including members and invites.</summary>
    Owner,

    /// <summary>Can log and edit events and catalog data.</summary>
    Parent,

    /// <summary>
    /// Can log events and edit or delete the events they logged themselves (e.g. a grandparent); reads everything a
    /// Viewer reads and manages nothing else.
    /// </summary>
    Caregiver,

    /// <summary>Read-only access.</summary>
    Viewer,

    /// <summary>
    /// A healthcare professional (self-declared in her <see cref="Professionals.ProfessionalProfile"/>) invited to this baby:
    /// reads everything a Viewer reads and in addition writes her own notes and consultation measurements. Outside the
    /// Owner &gt; Parent &gt; Caregiver &gt; Viewer order: never logs events, manages nothing and receives no baby reminders.
    /// </summary>
    Doctor,
}
