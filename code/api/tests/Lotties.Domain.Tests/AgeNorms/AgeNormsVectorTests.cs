using System.Text.Json;
using Lotties.Domain.AgeNorms;

namespace Lotties.Domain.Tests.AgeNorms;

/// <summary>
/// The lookup vectors shared with the web port (code/web/src/ageNorms/ageNormsVectors.json, linked into the test output),
/// run against the shipped file: the same metric, population and age must find the same norm, with the same prior
/// decision, on both sides.
/// </summary>
public sealed class AgeNormsVectorTests
{
    private static readonly Lazy<JsonDocument> Vectors = new(() => JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "AgeNorms", "ageNormsVectors.json"))));

    public static TheoryData<string> LookupNames => NamesOf("lookups");

    internal static TheoryData<string> NamesOf(string section)
    {
        var names = new TheoryData<string>();
        foreach (var vector in Vectors.Value.RootElement.GetProperty(section).EnumerateArray())
        {
            names.Add(vector.GetProperty("name").GetString()!);
        }

        return names;
    }

    internal static JsonElement VectorOf(string section, string name) =>
        Vectors.Value.RootElement.GetProperty(section).EnumerateArray().Single(item => item.GetProperty("name").GetString() == name);

    [Theory]
    [MemberData(nameof(LookupNames))]
    public void For_SharedVector_FindsTheExpectedNorm(string name)
    {
        var vector = VectorOf("lookups", name);
        var (metric, population, ageDays) = (vector.GetProperty("metric").GetString()!, vector.GetProperty("population").GetString()!, vector.GetProperty("ageDays").GetInt32());

        var norm = ShippedAgeNorms.Set.For(metric, population, ageDays);
        var prior = ShippedAgeNorms.Set.PriorFor(metric, population, ageDays);

        var expected = vector.GetProperty("expected");
        Assert.Equal(vector.GetProperty("prior").GetBoolean(), prior is not null);
        if (expected.ValueKind == JsonValueKind.Null)
        {
            Assert.Null(norm);
            return;
        }

        Assert.NotNull(norm);
        Assert.Equal(expected.GetProperty("id").GetString(), norm!.Id);
        Assert.Equal((Number(expected, "low"), Number(expected, "typical"), Number(expected, "high")), (norm.Low, norm.Typical, norm.High));
        Assert.Equal(expected.GetProperty("confidence").GetString(), norm.Confidence);
        Assert.Equal(expected.GetProperty("needsReview").GetBoolean(), norm.NeedsReview);
    }

    internal static decimal? Number(JsonElement element, string property) =>
        element.GetProperty(property).ValueKind == JsonValueKind.Null ? null : element.GetProperty(property).GetDecimal();
}
