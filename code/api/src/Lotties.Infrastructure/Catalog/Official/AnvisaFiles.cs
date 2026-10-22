using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>Rows read from a source file and how many records were skipped because they had fewer fields than the header.</summary>
public sealed record SourceRows<TRow>(IReadOnlyList<TRow> Rows, int ShortRecords, char Delimiter);

/// <summary>
/// Reads the ANVISA open data files by header name (case, accents and spaces in the header are ignored):
/// the registered-medicines file (<c>DADOS_ABERTOS_MEDICAMENTOS.csv</c>: <c>NOME_PRODUTO</c>,
/// <c>NUMERO_REGISTRO_PRODUTO</c>, <c>SITUACAO_REGISTRO</c>, <c>PRINCIPIO_ATIVO</c>) and the CMED price list
/// (<c>TA_PRECO_MEDICAMENTO.csv</c>: <c>REGISTRO</c>, <c>PRODUTO</c>, <c>APRESENTAÇÃO</c>; the header may follow a few
/// title lines). A missing column is an <see cref="InvalidImportFileException"/>.
/// </summary>
public static class AnvisaFiles
{
    private const int MaxTitleLines = 50;
    private static readonly string[] RegistrationColumns = ["NOME_PRODUTO", "NUMERO_REGISTRO_PRODUTO", "SITUACAO_REGISTRO", "PRINCIPIO_ATIVO"];
    private static readonly string[] PresentationColumns = ["REGISTRO", "PRODUTO", "APRESENTACAO"];

    /// <summary>The registration rows (at most <paramref name="limit"/> when given).</summary>
    public static SourceRows<AnvisaRegistrationRow> ReadRegistrations(string text, int? limit = null)
    {
        ArgumentNullException.ThrowIfNull(text);
        var delimiter = DelimitedText.DetectDelimiter(DelimitedText.FirstLine(text));
        var records = DelimitedText.Parse(text, delimiter);
        var table = Table.Read(records, RegistrationColumns, "registrations");
        var rows = table.Rows
            .Select(record => new AnvisaRegistrationRow(table.Value(record, 0), table.Value(record, 1), table.Value(record, 2), table.Value(record, 3)))
            .Take(limit ?? int.MaxValue)
            .ToArray();
        return new SourceRows<AnvisaRegistrationRow>(rows, table.ShortRecords, delimiter);
    }

    /// <summary>The CMED presentation rows.</summary>
    public static SourceRows<CmedPresentationRow> ReadPresentations(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var delimiter = DelimitedText.DetectDelimiter(DelimitedText.FirstLine(text));
        var table = Table.Read(DelimitedText.Parse(text, delimiter), PresentationColumns, "presentations");
        var rows = table.Rows
            .Select(record => new CmedPresentationRow(table.Value(record, 0), table.Value(record, 1), table.Value(record, 2)))
            .ToArray();
        return new SourceRows<CmedPresentationRow>(rows, table.ShortRecords, delimiter);
    }

    /// <summary>A header name compared without case, accents, surrounding spaces, or inner spaces (<c>APRESENTAÇÃO</c> -> <c>APRESENTACAO</c>).</summary>
    public static string HeaderKey(string header) =>
        MedicationNameMatcher.Normalize(header.Trim().TrimStart('﻿')).ToUpperInvariant().Replace(' ', '_');

    private sealed class Table
    {
        private readonly IReadOnlyList<int> _columns;

        private Table(IReadOnlyList<int> columns, IReadOnlyList<IReadOnlyList<string>> rows, int shortRecords)
        {
            _columns = columns;
            Rows = rows;
            ShortRecords = shortRecords;
        }

        public IReadOnlyList<IReadOnlyList<string>> Rows { get; }

        public int ShortRecords { get; }

        public static Table Read(IEnumerable<IReadOnlyList<string>> records, IReadOnlyList<string> required, string file)
        {
            var all = records.ToArray();
            var headerIndex = Array.FindIndex(all.Take(MaxTitleLines).ToArray(), record => HasColumns(record, required));
            if (headerIndex < 0)
            {
                throw new InvalidImportFileException(file, $"The {file} file has no header with the columns {string.Join(", ", required)}.");
            }

            var header = all[headerIndex].Select(HeaderKey).ToArray();
            var columns = required.Select(column => Array.IndexOf(header, column)).ToArray();
            var data = all.Skip(headerIndex + 1).ToArray();
            var complete = data.Where(record => record.Count > columns.Max()).ToArray();
            return new Table(columns, complete, data.Length - complete.Length);
        }

        public string Value(IReadOnlyList<string> record, int requiredIndex) => record[_columns[requiredIndex]].Trim();

        private static bool HasColumns(IReadOnlyList<string> record, IReadOnlyList<string> required)
        {
            var header = record.Select(HeaderKey).ToHashSet(StringComparer.Ordinal);
            return required.All(header.Contains);
        }
    }
}
