using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Lotties.Domain.CryReasons;

namespace Lotties.Domain.Tests.CryReasons;

/// <summary>
/// The scoring vectors shared with the web port (code/web/src/now/cryReasonsVectors.json, linked into the test output; the
/// web runs them in cryReasonsVectors.test.ts): the same signals must give the same causes, levels, scores, facts and
/// order on both sides.
/// </summary>
public sealed class CryReasonVectorTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly Lazy<JsonArray> Cases = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "CryReasons", "cryReasonsVectors.json")))!["cases"]!.AsArray());

    public static TheoryData<string> Names
    {
        get
        {
            var names = new TheoryData<string>();
            foreach (var vector in Cases.Value)
            {
                names.Add(vector!["name"]!.GetValue<string>());
            }

            return names;
        }
    }

    [Fact]
    public void Vectors_AreNotEmpty() => Assert.True(Cases.Value.Count > 20);

    [Theory]
    [MemberData(nameof(Names))]
    public void Rank_SharedVector_GivesTheWebRanking(string name)
    {
        var vector = Cases.Value.Single(item => item!["name"]!.GetValue<string>() == name)!;
        var signals = vector["signals"].Deserialize<CrySignals>(Json)!;

        var result = JsonSerializer.SerializeToNode(CryReasonRanker.Rank(signals), Json)!;

        Assert.Equal(Normalised(vector["expected"]!).ToJsonString(), Normalised(result).ToJsonString());
    }

    /// <summary>The ranking without the web's <c>basis</c>, without null members, with instants as UTC ticks (formats differ).</summary>
    private static JsonNode Normalised(JsonNode ranking)
    {
        var copy = JsonNode.Parse(ranking.ToJsonString())!.AsObject();
        copy.Remove("basis");
        Strip(copy);
        return copy;
    }

    private static void Strip(JsonNode node)
    {
        if (node is JsonArray array)
        {
            foreach (var item in array.Where(item => item is not null))
            {
                Strip(item!);
            }

            return;
        }

        if (node is not JsonObject obj)
        {
            return;
        }

        foreach (var key in obj.Where(member => member.Value is null).Select(member => member.Key).ToArray())
        {
            obj.Remove(key);
        }

        if (obj["expectedAt"] is JsonValue instant)
        {
            obj["expectedAt"] = DateTimeOffset.Parse(instant.GetValue<string>()).UtcTicks;
        }

        foreach (var child in obj.Select(member => member.Value).Where(value => value is not null).ToArray())
        {
            Strip(child!);
        }
    }
}
