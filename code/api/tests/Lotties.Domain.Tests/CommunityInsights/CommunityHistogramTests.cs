using System.Text.Json;
using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The percentile histogram (<see cref="CommunityHistogram"/>, <see cref="CommunityHistogramMechanism"/>) against the percentiles
/// study: the bin edges, the binning, the read-out of given noisy counts and the error of the noisy median over many draws must match
/// the vectors the study wrote (ml/tests/community_histogram_vectors.json, seed 1, the built configuration); and the snapped bin is
/// checked against the DP definition for neighbouring counts.
/// </summary>
public sealed class CommunityHistogramTests
{
    private static readonly Lazy<JsonElement> Vectors = new(() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "CommunityInsights", "community_histogram_vectors.json"))).RootElement);

    public static TheoryData<string> Metrics => new() { "bottle_ml_per_feed", "night_sleep_minutes", "naps_per_day", "day_sleep_minutes" };

    private static JsonElement MetricOf(string key) => Vectors.Value.GetProperty("metrics").GetProperty(key);

    private static (double Min, double Max, double Step, double BinWidth) Spec(JsonElement metric)
    {
        var clip = metric.GetProperty("clip");
        return (clip[0].GetDouble(), clip[1].GetDouble(), metric.GetProperty("step").GetDouble(), metric.GetProperty("binWidth").GetDouble());
    }

    [Theory]
    [MemberData(nameof(Metrics))]
    public void Edges_MatchTheStudy(string key)
    {
        var metric = MetricOf(key);
        var (min, max, step, binWidth) = Spec(metric);

        var edges = CommunityHistogram.Edges(min, max, step, binWidth);

        Assert.Equal(metric.GetProperty("edges").EnumerateArray().Select(edge => edge.GetDouble()), edges, (expected, actual) => Math.Abs(expected - actual) < 1e-9);
    }

    [Theory]
    [MemberData(nameof(Metrics))]
    public void Binning_MatchesTheStudy_EdgesIncluded(string key)
    {
        var metric = MetricOf(key);
        var (min, max, step, binWidth) = Spec(metric);
        var edges = CommunityHistogram.Edges(min, max, step, binWidth);

        Assert.All(metric.GetProperty("binning").EnumerateArray(), probe =>
            Assert.Equal(probe.GetProperty("bin").GetInt32(), CommunityHistogram.BinOf(probe.GetProperty("value").GetDouble(), edges)));
    }

    [Theory]
    [MemberData(nameof(Metrics))]
    public void Readout_OfGivenNoisyCounts_MatchesTheStudy(string key)
    {
        var metric = MetricOf(key);
        var (min, max, step, binWidth) = Spec(metric);
        var edges = CommunityHistogram.Edges(min, max, step, binWidth);

        Assert.All(metric.GetProperty("readouts").EnumerateArray(), readout =>
        {
            var counts = readout.GetProperty("counts").EnumerateArray().Select(count => count.GetDouble()).ToArray();
            var got = CommunityHistogram.Read(counts, edges, min, max, step);
            var expected = readout.GetProperty("expected");
            if (expected.ValueKind == JsonValueKind.Null)
            {
                Assert.Null(got);
                return;
            }

            Assert.Equal(expected.EnumerateArray().Select(value => value.GetDouble()), got!);
        });
    }

    [Theory]
    [MemberData(nameof(Metrics))]
    public void NoisyMedian_OfTheStudysCell_HasTheStudysError(string key)
    {
        var metric = MetricOf(key);
        var (min, max, step, binWidth) = Spec(metric);
        var cell = metric.GetProperty("cell").EnumerateArray().Select(value => value.GetDouble()).ToArray();
        var exact = metric.GetProperty("exactMedian").GetDouble();
        var studyError = metric.GetProperty("noisyMedianMeanAbsError").GetDouble();
        var edges = CommunityHistogram.Edges(min, max, step, binWidth);
        var noise = new SnappedLaplaceNoise(new SeededRandomSource(17));

        // The C# mechanism on the same cell, epsilon 2 per cell (scale 1/2), 40 000 draws: the same mean error within Monte Carlo
        // error (a few per cent) and half a published step at most.
        var errors = Enumerable.Range(0, 40_000)
            .Select(_ => Release(cell, edges, min, max, step, noise))
            .Where(quartiles => quartiles is not null)
            .Select(quartiles => Math.Abs(quartiles![1] - exact))
            .ToArray();

        Assert.InRange(errors.Average(), (studyError * 0.92) - (0.02 * step), (studyError * 1.08) + (0.02 * step));
    }

    [Fact]
    public void Readout_ATieBlock_IsSpreadOverItsBin()
    {
        var edges = CommunityHistogram.Edges(0, 400, 10, 20);
        var counts = CommunityHistogram.Counts(Enumerable.Repeat(150.0, 20), edges);

        Assert.Equal([140.0, 140.0, 150.0], CommunityHistogram.Read(counts, edges, 0, 400, 10)!);
    }

    [Fact]
    public void Readout_NoPositiveTotal_PublishesNothing()
    {
        var edges = CommunityHistogram.Edges(0, 8, 0.5, 0.5);

        Assert.Null(CommunityHistogram.Read(new double[edges.Count - 1], edges, 0, 8, 0.5));
        Assert.Null(CommunityHistogram.Read([-0.5, .. new double[edges.Count - 2]], edges, 0, 8, 0.5));
    }

    [Fact]
    public void Median_IsTheMiddleOrTheMeanOfTheTwoMiddles()
    {
        Assert.Equal(3.0, CommunityHistogram.Median([5.0, 1.0, 3.0]));
        Assert.Equal(2.5, CommunityHistogram.Median([4.0, 1.0, 3.0, 2.0]));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(1.0)]
    [InlineData(7.0)]
    [InlineData(40.0)]
    public void SnappedBin_NeighbouringCounts_DifferByAtMostEpsilon(double count)
    {
        // Exact probability of every output on the snap grid (0.5) for counts c and c + 1 at scale 1/2: the log ratio never
        // exceeds epsilon 2, the DP definition for adding or removing one baby (one count of one cell).
        const double scale = 0.5;
        var grid = CommunityLaplace.SnapGrid(scale);
        var outputs = Enumerable.Range(-60, 240).Select(index => index * grid).ToArray();

        var worst = outputs
            .Select(output => (With: SnappedMass(count + 1, output, scale, grid), Without: SnappedMass(count, output, scale, grid)))
            .Where(pair => pair.With > 1e-280 && pair.Without > 1e-280)
            .Max(pair => Math.Abs(Math.Log(pair.With) - Math.Log(pair.Without)));

        Assert.InRange(worst, 1.99, 2.0 + 1e-9);
    }

    [Fact]
    public void SnappedBin_Sampler_MatchesTheExactDistribution()
    {
        var random = new SeededRandomSource(29);
        const double scale = 0.5;
        var grid = CommunityLaplace.SnapGrid(scale);
        var draws = Enumerable.Range(0, 200_000).Select(_ => CommunityLaplace.Snapped(7.0, scale, SnappedLaplaceNoise.Bound, random)).ToArray();

        var tv = 0.5 * Enumerable.Range(-20, 80).Select(index => index * grid)
            .Sum(output => Math.Abs((draws.Count(draw => draw == output) / 200_000.0) - SnappedMass(7.0, output, scale, grid)));

        Assert.True(tv < 0.01, $"total variation {tv}");
    }

    private static IReadOnlyList<double>? Release(double[] cell, IReadOnlyList<double> edges, double min, double max, double step, ICommunityNoise noise)
    {
        var jittered = cell.Select(value => Math.Clamp(value + noise.Jitter(step / 2), min, max));
        var noisy = CommunityHistogram.Counts(jittered, edges).Select(count => noise.Perturb(count, 0.5)).ToArray();
        return CommunityHistogram.Read(noisy, edges, min, max, step);
    }

    /// <summary>The Laplace mass of the rounding interval of one snap-grid output, stable in both tails.</summary>
    private static double SnappedMass(double count, double output, double scale, double grid)
    {
        var low = (output - (grid / 2) - count) / scale;
        var high = (output + (grid / 2) - count) / scale;
        var upper = 0.5 * (Math.Exp(-Math.Max(low, 0)) - Math.Exp(-Math.Max(high, 0)));
        var lower = 0.5 * (Math.Exp(Math.Min(high, 0)) - Math.Exp(Math.Min(low, 0)));
        return low >= 0 ? upper : high <= 0 ? lower : upper + lower;
    }
}
