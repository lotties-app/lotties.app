using System.Text;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Application.Imports.Csv;

/// <summary>
/// RFC 4180 CSV reader: comma separated, fields optionally quoted with <c>"</c> (a doubled quote is a literal quote,
/// quoted fields may hold commas and line breaks), records end with CRLF, LF or CR, a leading UTF-8 BOM is ignored
/// and blank lines are skipped. Text after a closing quote is kept (lenient); an unterminated quote is an error.
/// </summary>
internal sealed class CsvReader
{
    private const char Quote = '"';
    private const char Delimiter = ',';
    private const char ByteOrderMark = '﻿';

    private readonly string _text;
    private readonly string _field;
    private int _position;

    private CsvReader(string text, string field)
    {
        _text = text;
        _field = field;
        _position = text.Length > 0 && text[0] == ByteOrderMark ? 1 : 0;
    }

    private bool AtEnd => _position >= _text.Length;

    /// <summary>
    /// All non-blank records of <paramref name="text"/>, the header included. Throws
    /// <see cref="ImportTooManyRowsException"/> when there are more than <paramref name="maxDataRecords"/> records
    /// after the header and <see cref="InvalidImportFileException"/> on an unterminated quote; <paramref name="field"/>
    /// names the input in those errors.
    /// </summary>
    public static IReadOnlyList<IReadOnlyList<string>> ReadAll(string text, string field, int maxDataRecords)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentException.ThrowIfNullOrWhiteSpace(field);
        return new CsvReader(text, field).ReadRecords(maxDataRecords);
    }

    private List<IReadOnlyList<string>> ReadRecords(int maxDataRecords)
    {
        var records = new List<IReadOnlyList<string>>();
        while (!AtEnd)
        {
            AddUnlessBlank(records, ReadRecord(), maxDataRecords);
        }

        return records;
    }

    private void AddUnlessBlank(List<IReadOnlyList<string>> records, IReadOnlyList<string> record, int maxDataRecords)
    {
        if (record is [""])
        {
            return;
        }

        records.Add(record);
        if (records.Count > maxDataRecords + 1)
        {
            throw new ImportTooManyRowsException(_field, maxDataRecords);
        }
    }

    private IReadOnlyList<string> ReadRecord()
    {
        var fields = new List<string> { ReadField() };
        while (ConsumeDelimiter())
        {
            fields.Add(ReadField());
        }

        ConsumeLineEnd();
        return fields;
    }

    private string ReadField() => !AtEnd && _text[_position] == Quote ? ReadQuotedField() : ReadUnquotedField();

    private string ReadUnquotedField()
    {
        var start = _position;
        var end = _text.IndexOfAny([Delimiter, '\r', '\n'], start);
        _position = end < 0 ? _text.Length : end;
        return _text[start.._position];
    }

    private string ReadQuotedField()
    {
        var value = new StringBuilder();
        _position++;
        while (ReadQuotedSegment(value))
        {
            value.Append(Quote);
        }

        return value.Append(ReadUnquotedField()).ToString();
    }

    /// <summary>Appends text up to the next quote and consumes it; returns <c>true</c> when it was an escaped (doubled) quote.</summary>
    private bool ReadQuotedSegment(StringBuilder value)
    {
        var closing = _text.IndexOf(Quote, _position);
        if (closing < 0)
        {
            throw new InvalidImportFileException(_field, $"{_field} has a quoted field that is never closed.");
        }

        value.Append(_text, _position, closing - _position);
        _position = closing + 1;
        var escaped = !AtEnd && _text[_position] == Quote;
        _position += escaped ? 1 : 0;
        return escaped;
    }

    private bool ConsumeDelimiter()
    {
        if (AtEnd || _text[_position] != Delimiter)
        {
            return false;
        }

        _position++;
        return true;
    }

    private void ConsumeLineEnd()
    {
        _position += !AtEnd && _text[_position] == '\r' ? 1 : 0;
        _position += !AtEnd && _text[_position] == '\n' ? 1 : 0;
    }
}
