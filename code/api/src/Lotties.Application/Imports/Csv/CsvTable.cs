using Lotties.Domain.Exceptions;

namespace Lotties.Application.Imports.Csv;

/// <summary>One data record of a <see cref="CsvTable"/>; <see cref="RowNumber"/> is 1-based and does not count the header.</summary>
internal sealed class CsvRow(int rowNumber, IReadOnlyList<string> fields, IReadOnlyDictionary<string, int> columns)
{
    public int RowNumber { get; } = rowNumber;

    /// <summary>The trimmed cell of <paramref name="column"/>, or <c>null</c> when it is empty or the record is shorter.</summary>
    public string? Get(string column)
    {
        var index = columns.GetValueOrDefault(column, -1);
        var value = index >= 0 && index < fields.Count ? fields[index].Trim() : string.Empty;
        return value.Length == 0 ? null : value;
    }
}

/// <summary>
/// A CSV file with a header record. Columns are found by name (trimmed, case-insensitive), so their order does not
/// matter and unknown columns are ignored; the first of two equally named columns wins.
/// </summary>
internal sealed class CsvTable
{
    private CsvTable(IReadOnlyList<CsvRow> rows)
    {
        Rows = rows;
    }

    public IReadOnlyList<CsvRow> Rows { get; }

    /// <summary>
    /// Reads <paramref name="text"/> (see <see cref="CsvReader"/>); throws <see cref="InvalidImportFileException"/>
    /// when it has no header or lacks one of <paramref name="requiredColumns"/>.
    /// </summary>
    public static CsvTable Read(string text, string field, int maxDataRows, IReadOnlyList<string> requiredColumns)
    {
        var records = CsvReader.ReadAll(text, field, maxDataRows);
        if (records.Count == 0)
        {
            throw new InvalidImportFileException(field, $"{field} is empty; a header row is required.");
        }

        var columns = ColumnsOf(records[0]);
        EnsureColumns(field, columns, requiredColumns);
        return new CsvTable(records.Skip(1).Select((record, index) => new CsvRow(index + 1, record, columns)).ToArray());
    }

    private static Dictionary<string, int> ColumnsOf(IReadOnlyList<string> header) =>
        header
            .Select((name, index) => (Name: name.Trim(), Index: index))
            .DistinctBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(column => column.Name, column => column.Index, StringComparer.OrdinalIgnoreCase);

    private static void EnsureColumns(string field, IReadOnlyDictionary<string, int> columns, IReadOnlyList<string> requiredColumns)
    {
        var missing = requiredColumns.Where(column => !columns.ContainsKey(column)).ToArray();
        if (missing.Length > 0)
        {
            throw new InvalidImportFileException(field, $"{field} is missing the column(s): {string.Join(", ", missing)}.");
        }
    }
}
