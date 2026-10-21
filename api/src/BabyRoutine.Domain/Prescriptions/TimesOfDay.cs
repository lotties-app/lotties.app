using System.Globalization;
using System.Text.RegularExpressions;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Prescriptions;

/// <summary>
/// The local clock times of a scheduled prescription (e.g. 08:00 and 20:00): 1-24 distinct <c>HH:mm</c> times, kept
/// sorted. Compared by value; stored and sent as <c>"HH:mm"</c> strings.
/// </summary>
public sealed partial record TimesOfDay
{
    public const int MaxCount = 24;
    public const string Field = "timesOfDay";
    public const string Format = "HH:mm";

    private TimesOfDay(IReadOnlyList<TimeOnly> values)
    {
        Values = values;
    }

    public IReadOnlyList<TimeOnly> Values { get; }

    /// <summary>Parses <c>HH:mm</c> texts (two-digit hour 00-23 and minute); throws <see cref="DomainValidationException"/> (field <c>timesOfDay</c>).</summary>
    public static TimesOfDay Parse(IReadOnlyList<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);
        return Create(texts.Select(ParseOne).ToArray());
    }

    public static TimesOfDay Create(IReadOnlyList<TimeOnly> times)
    {
        ArgumentNullException.ThrowIfNull(times);
        if (times.Count is 0 or > MaxCount)
        {
            throw new DomainValidationException(Field, $"timesOfDay must list 1 to {MaxCount} times.");
        }

        if (times.Any(time => time.Second != 0 || time.Millisecond != 0 || time.Microsecond != 0) || times.Distinct().Count() != times.Count)
        {
            throw new DomainValidationException(Field, "timesOfDay must be distinct whole minutes.");
        }

        return new TimesOfDay(times.Order().ToArray());
    }

    public IReadOnlyList<string> ToStrings() => Values.Select(time => time.ToString(Format, CultureInfo.InvariantCulture)).ToArray();

    public bool Equals(TimesOfDay? other) => other is not null && Values.SequenceEqual(other.Values);

    public override int GetHashCode() => Values.Aggregate(Values.Count, (hash, time) => HashCode.Combine(hash, time));

    private static TimeOnly ParseOne(string text) =>
        text is not null && Pattern().IsMatch(text)
            ? TimeOnly.ParseExact(text, Format, CultureInfo.InvariantCulture)
            : throw new DomainValidationException(Field, $"timesOfDay entries must be HH:mm (00:00-23:59), got '{text}'.");

    [GeneratedRegex(@"^([01][0-9]|2[0-3]):[0-5][0-9]\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
