using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class PredictionIntervalTests
{
    [Fact]
    public void FromPercentiles_ReturnsNull_WhenEmpty()
    {
        var result = PredictionInterval.FromPercentiles([], 0.1, 0.9);
        Assert.Null(result);
    }

    [Fact]
    public void FromPercentiles_ComputesCorrectBounds()
    {
        // 10 values: 1h, 2h, ..., 10h.
        var gaps = Enumerable.Range(1, 10).Select(i => TimeSpan.FromHours(i)).ToArray();

        var result = PredictionInterval.FromPercentiles(gaps, 0.1, 0.9);

        Assert.NotNull(result);
        Assert.Equal(TimeSpan.FromHours(5.5), result.Median);
        Assert.True(result.LowerBound < result.Median);
        Assert.True(result.UpperBound > result.Median);
        Assert.Equal(0.8, result.ConfidenceLevel, precision: 10);
    }

    [Fact]
    public void FromPercentiles_SingleValue_ReturnsSameForAll()
    {
        var gaps = new[] { TimeSpan.FromHours(3) };

        var result = PredictionInterval.FromPercentiles(gaps, 0.1, 0.9);

        Assert.NotNull(result);
        Assert.Equal(TimeSpan.FromHours(3), result.LowerBound);
        Assert.Equal(TimeSpan.FromHours(3), result.Median);
        Assert.Equal(TimeSpan.FromHours(3), result.UpperBound);
    }

    [Fact]
    public void FromPercentiles_TwoValues_Interpolates()
    {
        var gaps = new[] { TimeSpan.FromHours(2), TimeSpan.FromHours(4) };

        var result = PredictionInterval.FromPercentiles(gaps, 0.25, 0.75);

        Assert.NotNull(result);
        // P25 of [2,4]: position = 0.25 * 1 = 0.25 => 2 + 0.25*(4-2) = 2.5h.
        Assert.Equal(TimeSpan.FromHours(2.5), result.LowerBound);
        // Median (P50): position = 0.5 => 2 + 0.5*2 = 3h.
        Assert.Equal(TimeSpan.FromHours(3), result.Median);
        // P75: position = 0.75 => 2 + 0.75*2 = 3.5h.
        Assert.Equal(TimeSpan.FromHours(3.5), result.UpperBound);
        Assert.Equal(0.5, result.ConfidenceLevel, precision: 10);
    }

    [Fact]
    public void FromPercentiles_ConfidenceLevel_EqualsPercentileSpan()
    {
        var gaps = Enumerable.Range(1, 20).Select(i => TimeSpan.FromMinutes(i * 30)).ToArray();

        var result = PredictionInterval.FromPercentiles(gaps, 0.1, 0.9);

        Assert.NotNull(result);
        Assert.Equal(0.8, result.ConfidenceLevel, precision: 10);
    }
}