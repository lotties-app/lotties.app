using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Events;

/// <summary>
/// <see cref="BottleSegments"/>: the compact text grammar and the rules against the amounts, read from the vectors shared
/// with the web port (code/web/src/events/bottleSegmentsVectors.json, linked into the test output).
/// </summary>
public sealed class BottleSegmentsTests
{
    private static readonly Lazy<JsonDocument> Vectors = new(() => JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Events", "bottleSegmentsVectors.json"))));

    public static TheoryData<int> ParseCases => Indexes("parse");

    public static TheoryData<int> PayloadCases => Indexes("payloads");

    [Theory]
    [MemberData(nameof(ParseCases))]
    public void TryParse_SharedVector(int index)
    {
        var vector = Vectors.Value.RootElement.GetProperty("parse")[index];
        var expected = vector.GetProperty("segments");

        var parsed = BottleSegments.TryParse(vector.GetProperty("text").GetString());

        if (expected.ValueKind == JsonValueKind.Null)
        {
            Assert.Null(parsed);
            return;
        }

        Assert.NotNull(parsed);
        Assert.Equal(expected.EnumerateArray().Select(Segment), parsed);
    }

    [Theory]
    [MemberData(nameof(PayloadCases))]
    public void EnsureValid_SharedVector(int index)
    {
        var vector = Vectors.Value.RootElement.GetProperty("payloads")[index];
        var payload = EventPayload.From(vector.GetProperty("payload").GetRawText());
        var ended = vector.GetProperty("ended").GetBoolean();
        long? length = vector.TryGetProperty("lengthSeconds", out var seconds) ? seconds.GetInt64() : null;

        var error = Record.Exception(() => BottleSegments.EnsureValid(payload, ended, length));

        if (vector.GetProperty("valid").GetBoolean())
        {
            Assert.Null(error);
        }
        else
        {
            Assert.Equal(BottleSegments.Member, Assert.IsType<DomainValidationException>(error).Field);
        }
    }

    public static TheoryData<int> TotalsCases => Indexes("totals");

    public static TheoryData<int> ExtendsCases => Indexes("extends");

    [Theory]
    [MemberData(nameof(TotalsCases))]
    public void HistoryTotals_SharedVector(int index)
    {
        var vector = Vectors.Value.RootElement.GetProperty("totals")[index];
        var segments = BottleSegments.TryParse(vector.GetProperty("segments").GetString())!;
        var lengthElement = vector.GetProperty("lengthSeconds");
        long? length = lengthElement.ValueKind == JsonValueKind.Null ? null : lengthElement.GetInt64();
        var expected = vector.GetProperty("totals");

        var totals = BottleHistory.Totals(segments, length, vector.GetProperty("paused").GetBoolean(), vector.GetProperty("pausedSeconds").GetInt32());

        if (expected.ValueKind == JsonValueKind.Null)
        {
            Assert.Null(totals);
            return;
        }

        Assert.Equal(new BottleHistoryTotals(expected.GetProperty("pauseCount").GetInt32(), expected.GetProperty("pausedSeconds").GetInt32()), totals);
    }

    [Theory]
    [MemberData(nameof(ExtendsCases))]
    public void HistoryOnlyExtends_SharedVector(int index)
    {
        var vector = Vectors.Value.RootElement.GetProperty("extends")[index];

        var allowed = BottleHistory.OnlyExtends(Text(vector.GetProperty("before")), Text(vector.GetProperty("after")));

        Assert.Equal(vector.GetProperty("allowed").GetBoolean(), allowed);
    }

    [Fact]
    public void WithTotals_RecomputesThePauseKeysFromTheHistory()
    {
        var start = new DateTimeOffset(2026, 11, 2, 12, 25, 0, TimeSpan.Zero);
        var payload = EventPayload.From("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":105,"pause_count":1,"paused_seconds":7,"segments":"120>80@360+0;80>15@780+540"}""");

        var settled = BottleHistory.WithTotals(payload, start, start.AddSeconds(1680));

        var facts = EventPayloadFacts.Read(settled);
        Assert.Equal(2, facts.PauseCount);
        Assert.Equal(540, facts.PausedSeconds);
    }

    [Fact]
    public void ClosedAtStop_WhileDrinking_ClosesTheLastStretchFromTheResume()
    {
        var start = new DateTimeOffset(2026, 11, 2, 12, 25, 0, TimeSpan.Zero);
        var payload = EventPayload.From("""{"method":"bottle","amount_ml":120,"pause_count":1,"paused_seconds":180,"segments":"120>80@360+0"}""");

        var stopped = BottleHistory.ClosedAtStop(payload, start, start.AddSeconds(1000));

        Assert.Equal("120>80@360+0;80>?@460+540", stopped.GetString(BottleSegments.Member));
        Assert.Equal(stopped, BottleHistory.WithTotals(stopped, start, start.AddSeconds(1000)));
    }

    [Fact]
    public void WithTotals_WithoutTimes_LeavesThePayload()
    {
        var start = new DateTimeOffset(2026, 11, 2, 12, 25, 0, TimeSpan.Zero);
        var payload = EventPayload.From("""{"method":"bottle","amount_ml":120,"pause_count":1,"paused_seconds":7,"segments":"120>80@360;80>15@780"}""");

        Assert.Equal(payload, BottleHistory.WithTotals(payload, start, start.AddSeconds(1680)));
    }

    [Fact]
    public void DrunkMl_IsTheDropBetweenKnownLevels()
    {
        Assert.Equal(50, new BottleSegment(120, 70, 300).DrunkMl);
        Assert.Null(new BottleSegment(120, null, 300).DrunkMl);
        Assert.Null(new BottleSegment(null, 40, 300).DrunkMl);
    }

    [Fact]
    public void EnsureValid_NotText_IsLeftToTheFieldRules()
    {
        BottleSegments.EnsureValid(EventPayload.From("""{"method":"bottle","amount_ml":120,"segments":42}"""), ended: true);
    }

    private static BottleSegment Segment(JsonElement item) => new(
        Level(item.GetProperty("startMl")),
        Level(item.GetProperty("leftMl")),
        item.GetProperty("seconds").GetInt32(),
        item.TryGetProperty("begin", out var begin) ? begin.GetInt32() : null);

    private static string? Text(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : value.GetString();

    private static int? Level(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : value.GetInt32();

    private static TheoryData<int> Indexes(string list)
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Vectors.Value.RootElement.GetProperty(list).GetArrayLength(); i++)
        {
            data.Add(i);
        }

        return data;
    }
}
