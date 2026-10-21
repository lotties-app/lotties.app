using System.Globalization;
using System.Text.Json;
using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Events;

/// <summary>
/// Checks that a JSON value can be stored in a PostgreSQL <c>jsonb</c> column, walking it recursively: strings and
/// member names must be valid UTF-16 without NUL (<c>U+0000</c>, which <c>jsonb</c> rejects), and numbers must be at
/// most <see cref="MaxNumberLength"/> characters with an exponent within <see cref="MaxExponent"/> (beyond that
/// PostgreSQL <c>numeric</c> overflows).
/// </summary>
internal static class StorableJson
{
    public const int MaxNumberLength = 64;
    public const int MaxExponent = 1000;

    private static readonly char[] ExponentMarkers = ['e', 'E'];

    public static void Ensure(JsonElement element, string field)
    {
        Action<JsonElement, string> check = element.ValueKind switch
        {
            JsonValueKind.Object => EnsureObject,
            JsonValueKind.Array => EnsureArray,
            JsonValueKind.String => EnsureString,
            JsonValueKind.Number => EnsureNumber,
            _ => static (_, _) => { },
        };
        check(element, field);
    }

    private static void EnsureObject(JsonElement element, string field)
    {
        foreach (var member in element.EnumerateObject())
        {
            EnsureText(() => member.Name, field);
            Ensure(member.Value, field);
        }
    }

    private static void EnsureArray(JsonElement element, string field)
    {
        foreach (var item in element.EnumerateArray())
        {
            Ensure(item, field);
        }
    }

    private static void EnsureString(JsonElement element, string field) => EnsureText(() => element.GetString() ?? string.Empty, field);

    private static void EnsureText(Func<string> read, string field)
    {
        try
        {
            Text.EnsureNoNul(read(), field);
        }
        catch (InvalidOperationException)
        {
            throw new DomainValidationException(field, $"{field} contains a string that is not valid Unicode text.");
        }
    }

    private static void EnsureNumber(JsonElement element, string field)
    {
        var raw = element.GetRawText();
        if (raw.Length > MaxNumberLength || !HasStorableExponent(raw))
        {
            throw new DomainValidationException(field, $"{field} numbers must be at most {MaxNumberLength} characters with an exponent between -{MaxExponent} and {MaxExponent}.");
        }
    }

    private static bool HasStorableExponent(string raw)
    {
        var marker = raw.IndexOfAny(ExponentMarkers);
        return marker < 0
            || (int.TryParse(raw.AsSpan(marker + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var exponent)
                && exponent is >= -MaxExponent and <= MaxExponent);
    }
}
