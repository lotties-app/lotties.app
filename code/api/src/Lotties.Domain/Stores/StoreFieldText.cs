using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>
/// Shape rules for the typed fields of a <see cref="StoreDescriptor"/> (docs/design/47-bring-your-own-database.md section
/// 3.2 step 1): bounded length, no control characters and, for hosts, databases, user names and labels, none of <c>;</c>
/// <c>=</c>, so no connection-string option can be smuggled in. A password may hold any character but a control character:
/// real provider passwords contain <c>=</c> and <c>;</c>, and the connection string is built by
/// <c>NpgsqlConnectionStringBuilder</c>, which quotes and escapes every value. Error messages name the field only, never the value.
/// </summary>
internal static class StoreFieldText
{
    public const int MinPort = 1;
    public const int MaxPort = 65535;

    /// <summary>A single-token value (host, database, user name): trimmed, required, no whitespace inside.</summary>
    public static string Token(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        EnsurePresent(trimmed, field);
        EnsureLength(trimmed!, field, maxLength);
        EnsureNoForbiddenCharacters(trimmed!, field, allowSpaces: false);
        return trimmed!;
    }

    /// <summary>A single-line label: trimmed, required, spaces allowed.</summary>
    public static string Label(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        EnsurePresent(trimmed, field);
        EnsureLength(trimmed!, field, maxLength);
        EnsureNoForbiddenCharacters(trimmed!, field, allowSpaces: true);
        return trimmed!;
    }

    /// <summary>A secret: kept exactly as typed (not trimmed), required, any character but a control character.</summary>
    public static string Secret(string? value, string field, int maxLength)
    {
        EnsurePresent(value, field);
        EnsureLength(value!, field, maxLength);
        EnsureNoControlCharacters(value!, field);
        return value!;
    }

    public static int Port(int value, string field) =>
        value is >= MinPort and <= MaxPort
            ? value
            : throw new DomainValidationException(field, $"{field} must be between {MinPort} and {MaxPort}.");

    private static void EnsurePresent(string? value, string field)
    {
        if (string.IsNullOrEmpty(value))
        {
            throw new DomainValidationException(field, $"{field} is required.");
        }
    }

    private static void EnsureLength(string value, string field, int maxLength)
    {
        if (value.Length > maxLength)
        {
            throw new DomainValidationException(field, $"{field} must be at most {maxLength} characters.");
        }
    }

    private static void EnsureNoForbiddenCharacters(string value, string field, bool allowSpaces)
    {
        if (value.Any(character => IsForbidden(character, allowSpaces)))
        {
            throw new DomainValidationException(field, $"{field} contains a character that is not allowed.");
        }
    }

    private static void EnsureNoControlCharacters(string value, string field)
    {
        if (value.Any(char.IsControl))
        {
            throw new DomainValidationException(field, $"{field} contains a character that is not allowed.");
        }
    }

    private static bool IsForbidden(char character, bool allowSpaces) =>
        char.IsControl(character)
        || character is ';' or '='
        || (!allowSpaces && char.IsWhiteSpace(character));
}
