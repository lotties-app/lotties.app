using System.Globalization;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Clinical;

/// <summary>
/// The local calendar dates a clinical summary covers, both ends included. A range is at most <see cref="MaxDays"/> days
/// and within <see cref="EarliestDate"/> to <see cref="LatestDate"/> (so every local midnight is a valid instant).
/// </summary>
public sealed record ClinicalRange
{
    public const string FromField = "from";
    public const string ToField = "to";
    public const int MaxDays = 92;

    public static readonly DateOnly EarliestDate = new(2000, 1, 1);
    public static readonly DateOnly LatestDate = new(2100, 12, 31);

    private ClinicalRange(DateOnly from, DateOnly to)
    {
        From = from;
        To = to;
    }

    public DateOnly From { get; }

    public DateOnly To { get; }

    /// <summary>The number of local days, both ends included.</summary>
    public int DayCount => To.DayNumber - From.DayNumber + 1;

    /// <summary>
    /// Validates a range; throws <see cref="DomainValidationException"/> naming <c>from</c> or <c>to</c> when a date is
    /// missing or out of the supported years, <c>to</c> is before <c>from</c>, or the range is longer than <see cref="MaxDays"/> days.
    /// </summary>
    public static ClinicalRange Create(DateOnly? from, DateOnly? to)
    {
        var first = EnsureInSupportedYears(from, FromField);
        var last = EnsureInSupportedYears(to, ToField);
        EnsureOrdered(first, last);
        EnsureNotTooLong(first, last);
        return new ClinicalRange(first, last);
    }

    /// <summary>
    /// Reads <paramref name="from"/> and <paramref name="to"/> as <c>yyyy-MM-dd</c> dates (a missing or malformed one is a
    /// <see cref="DomainValidationException"/> naming the field) and validates them like <see cref="Create"/>.
    /// </summary>
    public static ClinicalRange Parse(string? from, string? to) => Create(ParseDate(from, FromField), ParseDate(to, ToField));

    /// <summary>The <paramref name="dayCount"/> local days that end with <paramref name="lastDay"/> (the day itself included).</summary>
    public static ClinicalRange LastDays(DateOnly lastDay, int dayCount)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(dayCount, 1);
        return Create(lastDay.AddDays(1 - dayCount), lastDay);
    }

    private static DateOnly? ParseDate(string? text, string field)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        return DateOnly.TryParseExact(text.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new DomainValidationException(field, $"{field} must be a date like 2026-03-08.");
    }

    private static DateOnly EnsureInSupportedYears(DateOnly? date, string field) => date switch
    {
        null => throw new DomainValidationException(field, $"{field} is required (yyyy-mm-dd)."),
        { } value when value < EarliestDate || value > LatestDate => throw new DomainValidationException(field, $"{field} must be between {EarliestDate:yyyy-MM-dd} and {LatestDate:yyyy-MM-dd}."),
        { } value => value,
    };

    private static void EnsureOrdered(DateOnly from, DateOnly to)
    {
        if (to < from)
        {
            throw new DomainValidationException(ToField, "to must not be before from.");
        }
    }

    private static void EnsureNotTooLong(DateOnly from, DateOnly to)
    {
        if (to.DayNumber - from.DayNumber + 1 > MaxDays)
        {
            throw new DomainValidationException(ToField, $"The range must be at most {MaxDays} days.");
        }
    }
}
