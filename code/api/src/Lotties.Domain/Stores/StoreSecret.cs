namespace Lotties.Domain.Stores;

/// <summary>
/// A store password. It has no public property, so serializers write <c>{}</c>, and <see cref="ToString"/> is redacted;
/// the value is read only through <see cref="Reveal"/>, by the code that seals it or opens a connection
/// (docs/design/47-bring-your-own-database.md section 3.3).
/// </summary>
public sealed class StoreSecret : IEquatable<StoreSecret>
{
    public const string Redacted = "[redacted]";

    private readonly string _value;

    private StoreSecret(string value)
    {
        _value = value;
    }

    /// <summary>Validates the shape (required, at most <paramref name="maxLength"/>, no control characters; <c>;</c>, <c>=</c>, quotes and spaces are allowed); never trims.</summary>
    public static StoreSecret Create(string? value, string field, int maxLength) =>
        new(StoreFieldText.Secret(value, field, maxLength));

    /// <summary>The secret in clear text. Never log it, never return it from an endpoint.</summary>
    public string Reveal() => _value;

    public bool Equals(StoreSecret? other) => other is not null && string.Equals(_value, other._value, StringComparison.Ordinal);

    public override bool Equals(object? obj) => obj is StoreSecret other && Equals(other);

    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(_value);

    public override string ToString() => Redacted;
}
