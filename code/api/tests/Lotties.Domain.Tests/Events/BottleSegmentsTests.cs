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

        var error = Record.Exception(() => BottleSegments.EnsureValid(payload, ended));

        if (vector.GetProperty("valid").GetBoolean())
        {
            Assert.Null(error);
        }
        else
        {
            Assert.Equal(BottleSegments.Member, Assert.IsType<DomainValidationException>(error).Field);
        }
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
        item.GetProperty("seconds").GetInt32());

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
