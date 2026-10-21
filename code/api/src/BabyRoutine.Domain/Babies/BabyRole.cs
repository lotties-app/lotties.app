namespace BabyRoutine.Domain.Babies;

/// <summary>A member's role on a baby.</summary>
public enum BabyRole
{
    /// <summary>Full control, including members and invites.</summary>
    Owner,

    /// <summary>Can log and edit events and catalog data.</summary>
    Parent,

    /// <summary>Read-only access.</summary>
    Viewer,
}
