using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Prescriptions;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Prescriptions;

public sealed class MedicationDosePayloadTests
{
    private static readonly Guid MedicationId = Guid.NewGuid();
    private static readonly DateTimeOffset GivenAt = new(2026, 3, 2, 10, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"medications":"x"}""")]
    [InlineData("""{"medications":[1,"a",null]}""")]
    [InlineData("""{"medications":[{"medicationId":"m1","name":"Colidis"}]}""")]
    [InlineData("""{"medications":[{"medicationId":"m1","name":"Colidis","dose":{"amount":2,"unit":"drops"}}]}""")]
    [InlineData("""{"medications":[{"medicationId":"m1","prescriptionId":null,"override":null,"kgUsed":null}]}""")]
    public void CheckExtensions_LegacyOrImporterPayloads_AreAccepted(string json)
    {
        Assert.Empty(MedicationDosePayload.CheckExtensions(EventPayload.From(json)));
    }

    [Fact]
    public void CheckExtensions_ValidMembers_ReturnTheReferences()
    {
        var prescriptionId = Guid.NewGuid();
        var payload = EventPayload.From($$"""{"medications":[{"medicationId":"{{MedicationId}}"},{"medicationId":"{{MedicationId}}","prescriptionId":"{{prescriptionId}}","override":true,"kgUsed":4.6}]}""");

        var reference = Assert.Single(MedicationDosePayload.CheckExtensions(payload));

        Assert.Equal(new PrescriptionReference(1, prescriptionId, MedicationId), reference);
        Assert.Equal("medications[1].prescriptionId", reference.Field);
    }

    [Theory]
    [InlineData("""{"medications":[{"prescriptionId":"nope"}]}""", "medications[0].prescriptionId")]
    [InlineData("""{"medications":[{"prescriptionId":42}]}""", "medications[0].prescriptionId")]
    [InlineData("""{"medications":[{"prescriptionId":"00000000-0000-0000-0000-000000000000"}]}""", "medications[0].prescriptionId")]
    [InlineData("""{"medications":[{},{"override":"yes"}]}""", "medications[1].override")]
    [InlineData("""{"medications":[{"kgUsed":0}]}""", "medications[0].kgUsed")]
    [InlineData("""{"medications":[{"kgUsed":1001}]}""", "medications[0].kgUsed")]
    [InlineData("""{"medications":[{"kgUsed":"4"}]}""", "medications[0].kgUsed")]
    public void CheckExtensions_InvalidMembers_ThrowForTheEntryField(string json, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => MedicationDosePayload.CheckExtensions(EventPayload.From(json)));

        Assert.Equal(field, exception.Field);
    }

    [Fact]
    public void EnsureReferencesValid_PrescriptionOfTheBabyForTheMedication_IsAccepted()
    {
        var prescription = AsNeeded(MedicationId, 60);
        prescription.SoftDelete(GivenAt);

        MedicationDosePayload.EnsureReferencesValid(BabyId, [new PrescriptionReference(0, prescription.Id, MedicationId)], [prescription]);
    }

    [Fact]
    public void EnsureReferencesValid_UnknownOtherBabyOrOtherMedication_Throws()
    {
        var prescription = AsNeeded(MedicationId, 60);
        var reference = new PrescriptionReference(0, prescription.Id, MedicationId);

        Assert.Throws<DomainValidationException>(() => MedicationDosePayload.EnsureReferencesValid(BabyId, [reference], []));
        Assert.Throws<DomainValidationException>(() => MedicationDosePayload.EnsureReferencesValid(Guid.NewGuid(), [reference], [prescription]));
        Assert.Throws<DomainValidationException>(() => MedicationDosePayload.EnsureReferencesValid(BabyId, [reference with { MedicationId = Guid.NewGuid() }], [prescription]));
    }

    [Fact]
    public void ReadDoses_ReadsIdsAndOverrideAndToleratesOtherShapes()
    {
        var prescriptionId = Guid.NewGuid();
        var payload = EventPayload.From($$"""{"medications":[{"medicationId":"{{MedicationId}}","prescriptionId":"{{prescriptionId}}","override":true},{"medicationId":"not-a-guid"},5]}""");

        var doses = MedicationDosePayload.ReadDoses(payload, GivenAt);

        Assert.Equal([new MedicationDose(GivenAt, MedicationId, prescriptionId, true), new MedicationDose(GivenAt, null, null, false)], doses);
    }

    [Fact]
    public void ReadDoses_NoMedications_IsEmpty()
    {
        Assert.Empty(MedicationDosePayload.ReadDoses(EventPayload.Empty, GivenAt));
    }
}
