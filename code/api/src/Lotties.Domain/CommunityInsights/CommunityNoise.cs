using System.Numerics;
using System.Security.Cryptography;

namespace Lotties.Domain.CommunityInsights;

/// <summary>A source of uniformly random 64-bit words (production: <see cref="CryptographicRandomSource"/>; tests inject a seeded one).</summary>
public interface ICommunityRandomSource
{
    /// <summary>64 independent, uniformly random bits.</summary>
    ulong NextBits();
}

/// <summary>The operating system's cryptographic random generator: the only source a real release may use.</summary>
public sealed class CryptographicRandomSource : ICommunityRandomSource
{
    public static CryptographicRandomSource Shared { get; } = new();

    public ulong NextBits()
    {
        Span<byte> bytes = stackalloc byte[sizeof(ulong)];
        RandomNumberGenerator.Fill(bytes);
        return BitConverter.ToUInt64(bytes);
    }
}

/// <summary>
/// The noise one share sum gets (docs/design/34-community-insights.md section 5 "Noise"): the exact value plus Laplace noise of the
/// given scale, on a fixed output grid. Production uses <see cref="SnappedLaplaceNoise"/>; tests of the counting rules may inject a
/// noise-free stand-in.
/// </summary>
public interface ICommunityNoise
{
    /// <summary>The noisy value of <paramref name="exact"/> for Laplace scale <paramref name="scale"/> (sensitivity / epsilon).</summary>
    double Perturb(double exact, double scale);
}

/// <summary>Mironov's snapping mechanism over <see cref="CommunityLaplace"/>, with a bound of <see cref="Bound"/>.</summary>
public sealed class SnappedLaplaceNoise(ICommunityRandomSource random) : ICommunityNoise
{
    /// <summary>The clamp bound B: larger than any share sum (a sum of per-baby weights, each baby at most 1).</summary>
    public const double Bound = 1 << 20;

    /// <summary>The noise of a real release: cryptographic randomness.</summary>
    public static SnappedLaplaceNoise Cryptographic() => new(CryptographicRandomSource.Shared);

    public double Perturb(double exact, double scale) => CommunityLaplace.Snapped(exact, scale, Bound, random);
}

/// <summary>
/// Laplace sampling that is sound in floating point (Mironov, "On significance of the least significant bits for differential
/// privacy", CCS 2012). The uniform draw covers (0, 1) with the full double distribution (a geometric exponent and 52 random
/// mantissa bits), so it is never 0 and its logarithm is always finite; <see cref="Snapped"/> clamps the input to [-B, B], adds
/// the noise, rounds to the multiple of the smallest power of two at least the scale and clamps again, so the low-order bits of
/// the output carry nothing about the exact value. The cost is a negligible addition to epsilon (2^-49 B / scale per value).
/// </summary>
public static class CommunityLaplace
{
    private const int MantissaBits = 52;

    private const int MinimumExponent = -1022;

    /// <summary>A uniform double in the open interval (0, 1): never 0, never 1.</summary>
    public static double OpenUnitUniform(ICommunityRandomSource random)
    {
        ArgumentNullException.ThrowIfNull(random);
        var exponent = GeometricExponent(random);
        var mantissa = random.NextBits() >> (64 - MantissaBits);
        return Math.ScaleB(1.0 + Math.ScaleB(mantissa, -MantissaBits), exponent);
    }

    /// <summary>One Laplace(0, <paramref name="scale"/>) draw: a random sign times scale times -ln(U).</summary>
    public static double Sample(double scale, ICommunityRandomSource random)
    {
        EnsureScale(scale);
        ArgumentNullException.ThrowIfNull(random);
        var negative = (random.NextBits() & 1UL) == 1UL;
        var magnitude = -scale * Math.Log(OpenUnitUniform(random));
        return negative ? -magnitude : magnitude;
    }

    /// <summary>
    /// The snapping mechanism: clamp(round_grid(clamp(exact) + Laplace(scale))), with <c>grid = </c><see cref="SnapGrid"/>(scale) and
    /// clamping to [-<paramref name="bound"/>, <paramref name="bound"/>]. Requires scale &lt; bound &lt; 2^46 scale.
    /// </summary>
    public static double Snapped(double exact, double scale, double bound, ICommunityRandomSource random)
    {
        EnsureScale(scale);
        EnsureFinite(exact, nameof(exact));
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(bound, scale);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(bound, Math.ScaleB(scale, 46));
        var noisy = Math.Clamp(exact, -bound, bound) + Sample(scale, random);
        var grid = SnapGrid(scale);
        return Math.Clamp(Math.Round(noisy / grid, MidpointRounding.ToEven) * grid, -bound, bound);
    }

    /// <summary>The smallest power of two at least <paramref name="scale"/> (the snapping grid).</summary>
    public static double SnapGrid(double scale)
    {
        EnsureScale(scale);
        var power = Math.ScaleB(1.0, Math.ILogB(scale));
        return power >= scale ? power : power * 2;
    }

    /// <summary>The exponent e of U in [2^e, 2^(e+1)): -1 with probability 1/2, -2 with 1/4, ...; never below the normal range.</summary>
    private static int GeometricExponent(ICommunityRandomSource random)
    {
        var exponent = -1;
        var bits = random.NextBits();
        while (bits == 0UL && exponent > MinimumExponent)
        {
            exponent -= 64;
            bits = random.NextBits();
        }

        return Math.Max(MinimumExponent, exponent - BitOperations.LeadingZeroCount(bits));
    }

    private static void EnsureScale(double scale)
    {
        EnsureFinite(scale, nameof(scale));
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(scale, 0.0);
    }

    private static void EnsureFinite(double value, string name)
    {
        if (!double.IsFinite(value))
        {
            throw new ArgumentOutOfRangeException(name, value, "The value must be a finite number.");
        }
    }
}
