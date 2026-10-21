namespace Lotties.Domain.Common;

/// <summary>Whole-number checks for JSON numbers read as <see cref="double"/>.</summary>
internal static class WholeNumbers
{
    /// <summary>Whether <paramref name="value"/> has no fractional part (infinities count as whole; range checks reject them).</summary>
    public static bool IsWhole(double value) => !double.IsNaN(value) && Math.Floor(value) == value;
}
