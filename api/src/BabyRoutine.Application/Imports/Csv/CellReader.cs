using System.Globalization;
using System.Text.RegularExpressions;
using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Application.Imports.Csv;

/// <summary>A reason a row could not be read, with its <see cref="ImportSkipCodes"/> code.</summary>
internal sealed record CellError(string Code, string Reason);

/// <summary>
/// Reads typed cells of one <see cref="CsvRow"/>, remembering the first cell that fails so the row can be skipped
/// with that reason (a failed cell reads as <c>null</c>). Numbers use the invariant culture (a lone decimal comma is
/// accepted); timestamps must be ISO-8601 with an explicit offset (<c>Z</c> or <c>±hh:mm</c>) and keep that offset.
/// </summary>
internal sealed partial class CellReader(CsvRow row)
{
    private const NumberStyles DecimalStyle = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;

    public CellError? Error { get; private set; }

    public string? Text(string column) => row.Get(column);

    public string? RequiredText(string column) => row.Get(column) ?? FailText(ImportSkipCodes.MissingValue, $"{column} is empty.");

    public DateTimeOffset? Timestamp(string column)
    {
        var text = row.Get(column);
        return text is null ? null : ParseTimestamp(column, text);
    }

    public DateTimeOffset? RequiredTimestamp(string column)
    {
        var text = row.Get(column);
        return text is null ? Fail<DateTimeOffset>(ImportSkipCodes.MissingValue, $"{column} is empty.") : ParseTimestamp(column, text);
    }

    public decimal? Number(string column)
    {
        var text = row.Get(column);
        return text is null ? null : ParseNumber(column, text);
    }

    public int? Integer(string column)
    {
        var number = Number(column);
        if (number is null)
        {
            return null;
        }

        return Math.Abs(number.Value) <= int.MaxValue
            ? (int)Math.Round(number.Value, MidpointRounding.AwayFromZero)
            : Fail<int>(ImportSkipCodes.InvalidValue, $"{column} '{number}' is out of range.");
    }

    /// <summary>A <c>yyyy-MM-dd</c> date, or the calendar date (in its own offset) of an ISO-8601 timestamp.</summary>
    public DateOnly? RequiredDate(string column)
    {
        var text = row.Get(column);
        return text is null ? Fail<DateOnly>(ImportSkipCodes.MissingValue, $"{column} is empty.") : ParseDate(column, text);
    }

    private DateTimeOffset? ParseTimestamp(string column, string text) =>
        IsoTimestamp().IsMatch(text) && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var value)
            ? value
            : Fail<DateTimeOffset>(ImportSkipCodes.InvalidValue, $"{column} '{text}' is not an ISO-8601 timestamp with an offset.");

    private decimal? ParseNumber(string column, string text)
    {
        var invariant = text.Contains('.') ? text : text.Replace(',', '.');
        return decimal.TryParse(invariant, DecimalStyle, CultureInfo.InvariantCulture, out var value)
            ? value
            : Fail<decimal>(ImportSkipCodes.InvalidValue, $"{column} '{text}' is not a number.");
    }

    private DateOnly? ParseDate(string column, string text) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : DateOf(ParseTimestamp(column, text));

    private static DateOnly? DateOf(DateTimeOffset? timestamp) => timestamp is null ? null : DateOnly.FromDateTime(timestamp.Value.DateTime);

    private string? FailText(string code, string reason)
    {
        Error ??= new CellError(code, reason);
        return null;
    }

    private T? Fail<T>(string code, string reason)
        where T : struct
    {
        Error ??= new CellError(code, reason);
        return null;
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex IsoTimestamp();
}
