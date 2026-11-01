using System.Text;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>
/// A small RFC 4180-style reader for the open data files: fields separated by a delimiter, optionally quoted
/// (<c>"a;b"</c>, doubled quotes inside quotes are one quote, quoted fields may span lines), records separated by LF or
/// CRLF. Blank lines are skipped.
/// </summary>
public static class DelimitedText
{
    private const char Quote = '"';

    /// <summary>The delimiter of a header line: the most frequent of <c>;</c>, <c>,</c> and tab outside quotes (<c>;</c> on a tie).</summary>
    public static char DetectDelimiter(string headerLine)
    {
        ArgumentNullException.ThrowIfNull(headerLine);
        return new[] { ';', ',', '\t' }
            .Select(candidate => (candidate, count: headerLine.Count(character => character == candidate)))
            .OrderByDescending(entry => entry.count)
            .First().candidate;
    }

    /// <summary>The first line of <paramref name="text"/> that is not blank (empty when there is none).</summary>
    public static string FirstLine(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        return text.Split('\n').Select(line => line.TrimEnd('\r')).FirstOrDefault(line => line.Trim().Length > 0) ?? string.Empty;
    }

    /// <summary>The records of <paramref name="text"/>, lazily.</summary>
    public static IEnumerable<IReadOnlyList<string>> Parse(string text, char delimiter)
    {
        ArgumentNullException.ThrowIfNull(text);
        var reader = new RecordReader(text, delimiter);
        while (reader.TryRead(out var record))
        {
            if (!IsBlank(record))
            {
                yield return record;
            }
        }
    }

    private static bool IsBlank(IReadOnlyList<string> record) => record.Count == 1 && record[0].Trim().Length == 0;

    private sealed class RecordReader(string text, char delimiter)
    {
        private readonly StringBuilder _field = new();
        private int _position;

        public bool TryRead(out IReadOnlyList<string> record)
        {
            record = [];
            if (_position >= text.Length)
            {
                return false;
            }

            var fields = new List<string>();
            while (ReadField(fields))
            {
            }

            record = fields;
            return true;
        }

        /// <summary>Reads one field into <paramref name="fields"/>; returns whether another field of the same record follows.</summary>
        private bool ReadField(List<string> fields)
        {
            _field.Clear();
            var quoted = _position < text.Length && text[_position] == Quote;
            _position += quoted ? 1 : 0;
            var next = quoted ? ReadQuoted() : ReadPlain();
            fields.Add(_field.ToString());
            return next;
        }

        private bool ReadPlain()
        {
            while (_position < text.Length)
            {
                var character = text[_position++];
                if (character == delimiter)
                {
                    return true;
                }

                if (IsLineEnd(character))
                {
                    return false;
                }

                _field.Append(character);
            }

            return false;
        }

        private bool ReadQuoted()
        {
            while (_position < text.Length)
            {
                var character = text[_position++];
                if (character != Quote)
                {
                    _field.Append(character);
                    continue;
                }

                if (_position < text.Length && text[_position] == Quote)
                {
                    _field.Append(Quote);
                    _position++;
                    continue;
                }

                return ReadPlain();
            }

            return false;
        }

        private bool IsLineEnd(char character)
        {
            if (character == '\r' && _position < text.Length && text[_position] == '\n')
            {
                _position++;
            }

            return character is '\n' or '\r';
        }
    }
}
