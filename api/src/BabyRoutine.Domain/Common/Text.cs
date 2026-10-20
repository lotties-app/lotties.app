using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Common;

/// <summary>Validation helpers for user-supplied text.</summary>
internal static class Text
{
    public static string Required(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new DomainValidationException(field, $"{field} is required.");
        }

        return EnsureMaxLength(trimmed, field, maxLength);
    }

    public static string? Optional(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : EnsureMaxLength(trimmed, field, maxLength);
    }

    private static string EnsureMaxLength(string value, string field, int maxLength)
    {
        if (value.Length > maxLength)
        {
            throw new DomainValidationException(field, $"{field} must be at most {maxLength} characters.");
        }

        return value;
    }
}
