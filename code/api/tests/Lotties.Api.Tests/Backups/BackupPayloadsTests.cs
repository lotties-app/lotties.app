using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Application.Backups;
using Lotties.Domain.EventTypes;

namespace Lotties.Api.Tests.Backups;

public sealed class BackupPayloadsTests
{
    private static readonly Guid Medication = Guid.NewGuid();
    private static readonly Guid Prescription = Guid.NewGuid();
    private static readonly Guid Formula = Guid.NewGuid();

    private static Guid Shift(string kind, Guid id) => new(id.ToByteArray().Select((b, i) => (byte)(i == 0 ? b ^ kind.Length : b)).ToArray());

    private static JsonElement Element(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void Remap_MedicationEvent_MapsEveryEntryReferenceAndKeepsTheRest()
    {
        var payload = Element($$"""{"medications":[{"medicationId":"{{Medication}}","name":"Colidis","dose":{"amount":2,"unit":"drops"},"prescriptionId":"{{Prescription}}","kgUsed":5.4},{"medicationId":"{{Medication}}","name":"Other"}],"extra":true}""");

        var result = JsonNode.Parse(BackupPayloads.Remap(payload, BuiltInEventTypes.MedicationId, Shift))!;

        var entries = result["medications"]!.AsArray();
        Assert.Equal(Shift("medication", Medication).ToString(), entries[0]!["medicationId"]!.ToString());
        Assert.Equal(Shift("prescription", Prescription).ToString(), entries[0]!["prescriptionId"]!.ToString());
        Assert.Equal(Shift("medication", Medication).ToString(), entries[1]!["medicationId"]!.ToString());
        Assert.Null(entries[1]!["prescriptionId"]);
        Assert.Equal(("Colidis", 5.4m, true), (entries[0]!["name"]!.ToString(), entries[0]!["kgUsed"]!.GetValue<decimal>(), result["extra"]!.GetValue<bool>()));
    }

    [Fact]
    public void Remap_BottleOfFormula_MapsTheFormulaId()
    {
        var payload = Element($$"""{"method":"bottle","formula_id":"{{Formula}}","formula_name":"Aptamil 2"}""");

        var result = JsonNode.Parse(BackupPayloads.Remap(payload, BuiltInEventTypes.FeedingId, Shift))!;

        Assert.Equal(Shift("formula", Formula).ToString(), result["formula_id"]!.ToString());
        Assert.Equal("Aptamil 2", result["formula_name"]!.ToString());
    }

    [Fact]
    public void Remap_OtherTypes_AreLeftAlone()
    {
        var text = $$"""{"formula_id":"{{Formula}}","medications":[{"medicationId":"{{Medication}}"}]}""";

        Assert.Equal(text, BackupPayloads.Remap(Element(text), BuiltInEventTypes.BathId, Shift));
    }

    [Theory]
    [InlineData("""{"medications":[{"medicationId":"not-a-guid","prescriptionId":5}]}""")]
    [InlineData("""{"medications":"x"}""")]
    [InlineData("""{"medications":[1,null,"a"]}""")]
    [InlineData("""{}""")]
    public void Remap_ValuesThatAreNotGuids_AreLeftForTheNormalChecks(string text)
    {
        var result = BackupPayloads.Remap(Element(text), BuiltInEventTypes.MedicationId, Shift);

        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(text), JsonNode.Parse(result)));
    }

    [Fact]
    public void Remap_NoPayloadOrNull_IsAnEmptyObject()
    {
        Assert.Equal("{}", BackupPayloads.Remap(null, BuiltInEventTypes.BathId, Shift));
        Assert.Equal("{}", BackupPayloads.Remap(Element("null"), BuiltInEventTypes.BathId, Shift));
    }

    [Fact]
    public void Remap_NotAnObject_IsPassedOnSoThePayloadCheckRefusesIt()
    {
        Assert.Equal("[1,2]", BackupPayloads.Remap(Element("[1,2]"), BuiltInEventTypes.BathId, Shift));
    }
}
