namespace Lotties.Domain.Assistants;

/// <summary>What a bottle held, as an assistant command names it.</summary>
public enum BottleKind
{
    /// <summary>Not said: the bottle is logged without <c>bottle_feeding_type</c>.</summary>
    Unspecified,

    /// <summary><c>bottle_feeding_type: formula</c>, naming the baby's current formula when there is one.</summary>
    Formula,

    /// <summary><c>bottle_feeding_type: breast_milk</c>.</summary>
    BreastMilk,
}

/// <summary>A breast side (nursing).</summary>
public enum BreastSide
{
    Left,
    Right,
}

/// <summary>A diaper's content, as an assistant command names it (stored as <c>WET</c>, <c>DIRTY</c>, <c>MIXED</c>).</summary>
public enum DiaperKind
{
    Wet,
    Dirty,
    Both,
}

/// <summary>How a feeding was given (the feeding <c>method</c>).</summary>
public enum FeedMethod
{
    /// <summary>No (or an unknown) method was recorded.</summary>
    Unknown,
    Breast,
    Bottle,
    Solid,
}

/// <summary>Limits of the values an assistant command takes.</summary>
public static class AssistantLimits
{
    /// <summary>The smallest bottle a voice command logs, in ml.</summary>
    public const int BottleMinMl = 1;

    /// <summary>The largest bottle a voice command logs, in ml (the Feed tray's stepper limit).</summary>
    public const int BottleMaxMl = 500;

    /// <summary>Whether <paramref name="amountMl"/> is a bottle a voice command may log.</summary>
    public static bool IsBottleAmount(int? amountMl) => amountMl is >= BottleMinMl and <= BottleMaxMl;
}
