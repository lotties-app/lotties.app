using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Clinical;

/// <summary>
/// The instants a timeline covers, [<see cref="From"/>, <see cref="To"/>): at most <see cref="MaxSpan"/> long. The doctor's
/// client asks one local day at a time; <see cref="MaxEvents"/> bounds what one answer carries.
/// </summary>
public sealed record TimelineRange
{
    public const string FromField = "from";
    public const string ToField = "to";
    public const int MaxEvents = 2000;

    public static readonly TimeSpan MaxSpan = TimeSpan.FromDays(8);

    private TimelineRange(DateTimeOffset from, DateTimeOffset to)
    {
        From = from;
        To = to;
    }

    /// <summary>The first instant, in UTC.</summary>
    public DateTimeOffset From { get; }

    /// <summary>The first instant after the range, in UTC.</summary>
    public DateTimeOffset To { get; }

    /// <summary>
    /// Validates a range; throws <see cref="DomainValidationException"/> naming <c>from</c> or <c>to</c> when one is
    /// missing, <c>to</c> is not after <c>from</c>, or the span is longer than <see cref="MaxSpan"/>.
    /// </summary>
    public static TimelineRange Create(DateTimeOffset? from, DateTimeOffset? to)
    {
        var start = UtcTime.Normalize(from ?? throw new DomainValidationException(FromField, "from is required (an ISO 8601 instant)."));
        var end = UtcTime.Normalize(to ?? throw new DomainValidationException(ToField, "to is required (an ISO 8601 instant)."));
        EnsureOrdered(start, end);
        EnsureNotTooLong(start, end);
        return new TimelineRange(start, end);
    }

    private static void EnsureOrdered(DateTimeOffset from, DateTimeOffset to)
    {
        if (to <= from)
        {
            throw new DomainValidationException(ToField, "to must be after from.");
        }
    }

    private static void EnsureNotTooLong(DateTimeOffset from, DateTimeOffset to)
    {
        if (to - from > MaxSpan)
        {
            throw new DomainValidationException(ToField, $"The span must be at most {MaxSpan.TotalDays:0} days.");
        }
    }
}
