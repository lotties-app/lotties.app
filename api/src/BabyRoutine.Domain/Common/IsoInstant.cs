using System.Globalization;
using System.Text.RegularExpressions;

namespace BabyRoutine.Domain.Common;

/// <summary>
/// ISO-8601 instants as clients send them in payloads: <c>yyyy-MM-ddTHH:mm[:ss[.fffffff]]</c> followed by <c>Z</c> or
/// <c>±hh:mm</c> (an offset is required so the instant is unambiguous), e.g. <c>2026-10-21T10:15:00.000Z</c>.
/// </summary>
internal static partial class IsoInstant
{
    public static bool TryParse(string? text, out DateTimeOffset value)
    {
        value = default;
        return text is not null
            && Pattern().IsMatch(text)
            && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})\z", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex Pattern();
}
