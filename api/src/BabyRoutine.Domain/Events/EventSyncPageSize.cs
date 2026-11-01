using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Events;

/// <summary>How many events one delta-sync page returns: <see cref="Default"/> unless the client asks for fewer.</summary>
public readonly record struct EventSyncPageSize
{
    public const int Default = 500;
    public const int Max = 500;
    private const string Field = "limit";

    private EventSyncPageSize(int value)
    {
        Value = value;
    }

    public int Value { get; }

    /// <summary><c>null</c> yields <see cref="Default"/>; otherwise 1 to <see cref="Max"/>.</summary>
    public static EventSyncPageSize From(int? requested) => requested switch
    {
        null => new EventSyncPageSize(Default),
        >= 1 and <= Max => new EventSyncPageSize(requested.Value),
        _ => throw new DomainValidationException(Field, $"The page size must be between 1 and {Max}."),
    };

    public override string ToString() => Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
