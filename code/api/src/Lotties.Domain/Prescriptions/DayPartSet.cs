using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Prescriptions;

/// <summary>
/// The parts of the day of a part-of-the-day prescription ("1 drop in the morning"): 1-4 distinct parts, kept in the
/// order of the day; one dose per chosen part per day. Compared by value; stored and sent as codes
/// (<c>["morning","night"]</c>, see <see cref="DayPartWindows.CodeOf"/>).
/// </summary>
public sealed record DayPartSet
{
    public const string Field = "dayParts";

    private DayPartSet(IReadOnlyList<DayPart> values)
    {
        Values = values;
    }

    public IReadOnlyList<DayPart> Values { get; }

    /// <summary>Parses part codes; throws <see cref="DomainValidationException"/> (field <c>dayParts</c>).</summary>
    public static DayPartSet Parse(IReadOnlyList<string> codes)
    {
        ArgumentNullException.ThrowIfNull(codes);
        return Create(codes.Select(ParseOne).ToArray());
    }

    public static DayPartSet Create(IReadOnlyList<DayPart> parts)
    {
        ArgumentNullException.ThrowIfNull(parts);
        if (parts.Count == 0 || parts.Any(part => !Enum.IsDefined(part)))
        {
            throw new DomainValidationException(Field, "dayParts must list 1 to 4 of morning, afternoon, evening and night.");
        }

        if (parts.Distinct().Count() != parts.Count)
        {
            throw new DomainValidationException(Field, "dayParts must be distinct.");
        }

        return new DayPartSet(parts.Order().ToArray());
    }

    public bool Contains(DayPart part) => Values.Contains(part);

    public IReadOnlyList<string> ToCodes() => Values.Select(DayPartWindows.CodeOf).ToArray();

    public bool Equals(DayPartSet? other) => other is not null && Values.SequenceEqual(other.Values);

    public override int GetHashCode() => Values.Aggregate(Values.Count, HashCode.Combine);

    private static DayPart ParseOne(string code) =>
        DayPartWindows.TryParse(code, out var part)
            ? part
            : throw new DomainValidationException(Field, $"dayParts entries must be morning, afternoon, evening or night, got '{code}'.");
}
