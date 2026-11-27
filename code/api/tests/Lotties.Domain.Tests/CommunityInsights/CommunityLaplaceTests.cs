using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The noise sampler (<see cref="CommunityLaplace"/>, <see cref="SnappedLaplaceNoise"/>): the uniform draw and the Laplace
/// distribution checked statistically on a seeded source, the snapping grid, the extremes (no log of 0, no throw), and the
/// cryptographic source a real release uses.
/// </summary>
public sealed class CommunityLaplaceTests
{
    private const int Draws = 200_000;

    [Fact]
    public void OpenUnitUniform_IsUniformOnTheOpenInterval()
    {
        var random = new SeededRandomSource(11);
        var draws = Enumerable.Range(0, Draws).Select(_ => CommunityLaplace.OpenUnitUniform(random)).ToArray();

        Assert.All(draws, draw => Assert.True(draw > 0.0 && draw < 1.0));
        Assert.InRange(draws.Average(), 0.497, 0.503);
        Assert.InRange(draws.Count(draw => draw < 0.25) / (double)Draws, 0.245, 0.255);
        Assert.InRange(draws.Count(draw => draw < 0.01) / (double)Draws, 0.0085, 0.0115);
    }

    [Theory]
    [InlineData(0.2)]
    [InlineData(2.0)]
    [InlineData(10.0)]
    public void Sample_FollowsTheLaplaceDistribution(double scale)
    {
        var random = new SeededRandomSource(23);
        var draws = Enumerable.Range(0, Draws).Select(_ => CommunityLaplace.Sample(scale, random)).ToArray();

        // Laplace(0, b): mean 0, mean |x| = b, variance 2 b^2, P(x > b) = e^-1 / 2, symmetric.
        Assert.InRange(draws.Average() / scale, -0.01, 0.01);
        Assert.InRange(draws.Average(Math.Abs) / scale, 0.99, 1.01);
        Assert.InRange(draws.Average(draw => draw * draw) / (2 * scale * scale), 0.97, 1.03);
        Assert.InRange(draws.Count(draw => draw > scale) / (double)Draws, (Math.Exp(-1) / 2) - 0.003, (Math.Exp(-1) / 2) + 0.003);
        Assert.InRange(draws.Count(draw => draw < -scale) / (double)Draws, (Math.Exp(-1) / 2) - 0.003, (Math.Exp(-1) / 2) + 0.003);
    }

    [Theory]
    [InlineData(0.2, 0.25)]
    [InlineData(0.25, 0.25)]
    [InlineData(1.0, 1.0)]
    [InlineData(5.0, 8.0)]
    [InlineData(10.0, 16.0)]
    [InlineData(0.001, 0.001953125)]
    [InlineData(0.0009765625, 0.0009765625)]
    public void SnapGrid_IsTheSmallestPowerOfTwoAtLeastTheScale(double scale, double grid)
    {
        Assert.Equal(grid, CommunityLaplace.SnapGrid(scale));
    }

    [Theory]
    [InlineData(0.2)]
    [InlineData(10.0)]
    public void Snapped_IsOnTheGrid_AndCentredOnTheExactValue(double scale)
    {
        var random = new SeededRandomSource(31);
        var grid = CommunityLaplace.SnapGrid(scale);
        var draws = Enumerable.Range(0, Draws).Select(_ => CommunityLaplace.Snapped(37.3, scale, SnappedLaplaceNoise.Bound, random)).ToArray();

        // Rounding to the grid biases the mean a little (at most about grid / pi times the Laplace characteristic function at
        // 2 pi / grid, under 0.02 grid for these scales); the sampling error is far smaller.
        Assert.All(draws, draw => Assert.Equal(0.0, Math.IEEERemainder(draw, grid)));
        Assert.InRange(draws.Average() - 37.3, -0.05 * grid, 0.05 * grid);
    }

    [Fact]
    public void Snapped_LowOrderBitsOfTheExactValue_DoNotReachTheOutput()
    {
        // The floating-point attack reads the exact value from the low bits of a noisy double; snapped, two exact values a hair
        // apart give the same output for the same draws almost always, and both outputs are on the grid.
        var first = new SeededRandomSource(5);
        var second = new SeededRandomSource(5);
        var same = Enumerable.Range(0, 10_000)
            .Count(_ => CommunityLaplace.Snapped(12.0, 0.2, SnappedLaplaceNoise.Bound, first) == CommunityLaplace.Snapped(12.0 + 1e-9, 0.2, SnappedLaplaceNoise.Bound, second));

        Assert.True(same >= 9_990, $"only {same} of 10000 equal");
    }

    [Theory]
    [InlineData(0UL)]
    [InlineData(ulong.MaxValue)]
    [InlineData(1UL)]
    [InlineData(0x8000000000000000UL)]
    [InlineData(0x0000000100000000UL)]
    public void Snapped_ExtremeDrawsAndValues_NeverThrowAndStayInTheBound(ulong bits)
    {
        var random = new ConstantRandomSource(bits);
        double[] values = [0.0, -0.0, double.Epsilon, 1e-300, SnappedLaplaceNoise.Bound, -SnappedLaplaceNoise.Bound, 1e308, -1e308, double.MaxValue, double.MinValue];
        double[] scales = [0.001, 0.2, 10.0, 1e4];

        var outputs = values.SelectMany(value => scales.Select(scale => (Scale: scale, Output: CommunityLaplace.Snapped(value, scale, SnappedLaplaceNoise.Bound, random)))).ToArray();

        Assert.All(outputs, output => Assert.True(double.IsFinite(output.Output) && Math.Abs(output.Output) <= SnappedLaplaceNoise.Bound));
        Assert.All(outputs, output => Assert.Equal(0.0, Math.IEEERemainder(output.Output, CommunityLaplace.SnapGrid(output.Scale))));
    }

    [Theory]
    [InlineData(0UL)]
    [InlineData(ulong.MaxValue)]
    public void Sample_ExtremeDraws_AreFinite(ulong bits)
    {
        var draw = CommunityLaplace.Sample(10.0, new ConstantRandomSource(bits));

        Assert.True(double.IsFinite(draw));
        Assert.InRange(Math.Abs(draw), 0.0, 10.0 * 710);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(0.0)]
    [InlineData(-1.0)]
    public void Sample_InvalidScale_IsAnArgumentError(double scale)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CommunityLaplace.Sample(scale, new SeededRandomSource(1)));
    }

    [Fact]
    public void Snapped_NonFiniteValue_IsAnArgumentError()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CommunityLaplace.Snapped(double.NaN, 1.0, SnappedLaplaceNoise.Bound, new SeededRandomSource(1)));
    }

    [Fact]
    public void CryptographicSource_IsWhatARealReleaseUses_AndLooksUniform()
    {
        var random = CryptographicRandomSource.Shared;
        var words = Enumerable.Range(0, 20_000).Select(_ => random.NextBits()).ToArray();

        Assert.True(words.Distinct().Count() > 19_990);
        Assert.InRange(words.Average(word => System.Numerics.BitOperations.PopCount(word)), 31.8, 32.2);
        Assert.InRange(Enumerable.Range(0, 20_000).Select(_ => CommunityLaplace.OpenUnitUniform(random)).Average(), 0.49, 0.51);
        Assert.IsType<SnappedLaplaceNoise>(SnappedLaplaceNoise.Cryptographic());
    }
}
