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
}
