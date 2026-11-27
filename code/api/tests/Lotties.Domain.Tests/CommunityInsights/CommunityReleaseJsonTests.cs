using System.Text.Json;
using System.Text.RegularExpressions;
using Lotties.Domain.CommunityInsights;
using static Lotties.Domain.Tests.CommunityInsights.CommunityFixtures;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The served release format (<see cref="CommunityReleaseJson"/>, docs/design/34-community-insights.md section 6): one writer and one
/// strict reader, a fixed order, placeholders, and nothing in it that is an exact count or an identifier.
/// </summary>
public sealed partial class CommunityReleaseJsonTests
{
    private static readonly DateTimeOffset GeneratedAt = new(2026, 11, 29, 3, 30, 0, TimeSpan.Zero);

    /// <summary>Every property name the release format has; anything else would be a new field to review.</summary>
    private static readonly string[] Properties =
    [
        "schemaVersion", "generatedAt", "catalogVersion", "placeholder", "statistics", "cells",
        "key", "k", "epsilon",
        "statistic", "band", "fromWeeks", "toWeeks", "dimension", "outputs", "babies",
    ];

    private static CommunityRelease Sample() => new(
        GeneratedAt,
        2,
        IsPlaceholder: false,
        [new(Cry, 20, 0.2m), new(Tummy, 20, 5m)],
        [
            new(Tummy, new CommunityBand(8, 9), null, new Dictionary<string, decimal> { ["share_of_days_with_any"] = 0.62m }, CommunityGroupSize.Babies50To99),
            new(Cry, new CommunityBand(0, 6), "evening", new Dictionary<string, decimal> { ["share_helped_by_cause.gas"] = 0.4m, ["share_helped_by_cause.comfort"] = 0.6m }, CommunityGroupSize.Babies20To49),
        ]);

    [Fact]
    public void Serialize_WritesTheSchemaInAFixedOrder()
    {
        var json = CommunityReleaseJson.Serialize(Sample());

        Assert.Equal(
            """{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"cry_outcome_by_cause","k":20,"epsilon":0.2},{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"cry_outcome_by_cause","band":{"fromWeeks":0,"toWeeks":6},"dimension":"evening","outputs":{"share_helped_by_cause.comfort":0.6,"share_helped_by_cause.gas":0.4},"babies":"20-49"},{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":0.62},"babies":"50-99"}]}""",
            json);
    }

    [Fact]
    public void Parse_ReadsWhatSerializeWrote()
    {
        var json = CommunityReleaseJson.Serialize(Sample());

        var parsed = CommunityReleaseJson.Parse(json);

        Assert.Equal(json, CommunityReleaseJson.Serialize(parsed));
        Assert.Equal(0.62m, parsed.CellFor(Tummy, 8, null)!.Outputs["share_of_days_with_any"]);
        Assert.Null(parsed.CellFor(Tummy, 9, null));
    }

    [Fact]
    public void Placeholder_HasNoStatisticNorCell()
    {
        var json = CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(GeneratedAt, 2));

        var parsed = CommunityReleaseJson.Parse(json);

        Assert.Equal("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":true,"statistics":[],"cells":[]}""", json);
        Assert.True(parsed.IsPlaceholder);
        Assert.Null(parsed.CellFor(Tummy, 8, null));
    }

    [Theory]
    [InlineData("""{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}""")]
    [InlineData("""{"schemaVersion":2,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":true,"statistics":[],"cells":[]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":true,"statistics":[],"cells":[],"count":3}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":true,"statistics":[]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":true,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":0.5},"babies":"20-49"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":0.5},"babies":"23"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":1.5},"babies":"20-49"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":8},"outputs":{"share_of_days_with_any":0.5},"babies":"20-49"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{},"babies":"20-49"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":0.5},"babies":"20-49"},{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":0.4},"babies":"20-49"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"epsilon":5}],"cells":[{"statistic":"tummy_minutes_per_day","band":{"fromWeeks":8,"toWeeks":9},"outputs":{"share_of_days_with_any":0.5,"share_of_days_with_any":0.4},"babies":"20-49"}]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":0,"epsilon":5}],"cells":[]}""")]
    [InlineData("""{"schemaVersion":1,"generatedAt":"2026-11-29T03:30:00+00:00","catalogVersion":2,"placeholder":false,"statistics":[{"key":"tummy_minutes_per_day","k":20,"kHysteresis":18,"epsilon":5}],"cells":[]}""")]
    [InlineData("not json")]
    public void Parse_AnythingButThisSchema_IsAFormatException(string json)
    {
        Assert.Throws<FormatException>(() => CommunityReleaseJson.Parse(json));
    }

    [Fact]
    public void Serialize_InvalidRelease_IsRefused()
    {
        var placeholderWithCells = Sample() with { IsPlaceholder = true };

        Assert.Throws<ArgumentException>(() => CommunityReleaseJson.Serialize(placeholderWithCells));
    }

    [Fact]
    public void Release_OfARun_HoldsNoExactCountAndNoIdentifier()
    {
        // 37 babies from 23 families in one tummy cell and 41 in one cry cell: neither number, nor any id or day, may appear.
        var tummyBabies = NewBabies(37, 23);
        var cryBabies = NewBabies(41, 41);
        var input = Input(
            tummy: TummyDays(tummyBabies, 100, withTummy: 30, days: 3),
            spells: Spells(cryBabies, 9, "gas"));

        var json = CommunityReleaseJson.Serialize(Run(input, new SnappedLaplaceNoise(new SeededRandomSource(9))));

        using var document = JsonDocument.Parse(json);
        Assert.Equal(2, document.RootElement.GetProperty("cells").GetArrayLength());
        Assert.All(PropertyNames(document.RootElement), name => Assert.True(Properties.Contains(name) || IsValueName(name), $"unexpected property '{name}'"));
        Assert.All(Numbers(document.RootElement), number => Assert.DoesNotContain(number, new[] { 37m, 23m, 41m, 37m * 3, 30m, 30m * 3 }));
        Assert.All(Strings(document.RootElement, "babies"), bucket => Assert.Contains(bucket, new[] { "20-49", "50-99", "100+" }));
        Assert.DoesNotMatch(GuidPattern(), json);
        Assert.All(tummyBabies.Concat(cryBabies), baby => Assert.DoesNotContain(baby.Baby.ToString("N")[..8], json, StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(FirstDay.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), json, StringComparison.Ordinal);
    }

    private static bool IsValueName(string name) => name.StartsWith("share_", StringComparison.Ordinal);

    private static IEnumerable<string> PropertyNames(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => element.EnumerateObject().SelectMany(property => PropertyNames(property.Value).Prepend(property.Name)),
        JsonValueKind.Array => element.EnumerateArray().SelectMany(PropertyNames),
        _ => [],
    };

    private static IEnumerable<decimal> Numbers(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => element.EnumerateObject().SelectMany(property => Numbers(property.Value)),
        JsonValueKind.Array => element.EnumerateArray().SelectMany(Numbers),
        JsonValueKind.Number => [element.GetDecimal()],
        _ => [],
    };

    private static IEnumerable<string> Strings(JsonElement element, string property) => element.ValueKind switch
    {
        JsonValueKind.Object => element.EnumerateObject().SelectMany(child => child.Name == property && child.Value.ValueKind == JsonValueKind.String ? [child.Value.GetString()!] : Strings(child.Value, property)),
        JsonValueKind.Array => element.EnumerateArray().SelectMany(child => Strings(child, property)),
        _ => [],
    };

    [GeneratedRegex("[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}")]
    private static partial Regex GuidPattern();
}
