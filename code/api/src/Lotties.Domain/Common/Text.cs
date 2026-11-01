using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Common;

/// <summary>
/// Validation helpers for user-supplied text: trimmed, bounded by the column length and free of NUL (<c>U+0000</c>)
/// characters, which PostgreSQL text columns cannot store.
/// </summary>
internal static class Text
{
    public const char Nul = '\0';

    public static string Required(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new DomainValidationException(field, $"{field} is required.");
        }

        return EnsureStorable(trimmed, field, maxLength);
    }

    public static string? Optional(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : EnsureStorable(trimmed, field, maxLength);
    }

    /// <summary>Throws <see cref="DomainValidationException"/> when <paramref name="value"/> contains a NUL character.</summary>
    public static string EnsureNoNul(string value, string field)
    {
        if (value.Contains(Nul, StringComparison.Ordinal))
        {
            throw new DomainValidationException(field, $"{field} must not contain NUL characters.");
        }

        return value;
    }

    private static string EnsureStorable(string value, string field, int maxLength)
    {
        if (value.Length > maxLength)
        {
            throw new DomainValidationException(field, $"{field} must be at most {maxLength} characters.");
        }

        return EnsureNoNul(value, field);
    }
}
