using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Measurements;
using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Domain.Tests.Common;

/// <summary>Client values that PostgreSQL could not store are rejected by the domain (400), never by the database (500).</summary>
public sealed class StorageLimitTests
{
    private const string WithNul = "a\0b";

    [Fact]
    public void BabyCreate_NameWithNul_ThrowsValidation()
    {
        var exception = Assert.Throws<DomainValidationException>(() => Baby.Create(WithNul, TestClock.Today, Guid.NewGuid(), TestClock.Now));

        Assert.Equal("Name", exception.Field);
    }

    [Fact]
    public void MedicationCreate_NotesWithNul_ThrowsValidation()
    {
        var exception = Assert.Throws<DomainValidationException>(() => Medication.Create(Guid.NewGuid(), "Simethicone", null, WithNul, isUsual: false, TestClock.Now));

        Assert.Equal("Notes", exception.Field);
    }

    [Fact]
    public void DosageCreate_UnitWithNul_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Dosage.Create(1, WithNul));
    }

    [Fact]
    public void EventCreate_NotesWithNul_ThrowsValidation()
    {
        var exception = Assert.Throws<DomainValidationException>(
            () => Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.SleepId, Guid.NewGuid(), TestClock.Now, null, EventPayload.Empty, WithNul, TestClock.Now));

        Assert.Equal("Notes", exception.Field);
    }

    [Fact]
    public void MeasurementCreate_NotesWithNul_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(
            () => Measurement.Create(Guid.NewGuid(), Guid.NewGuid(), TestClock.Today, 4.2m, null, null, WithNul, Guid.NewGuid(), TestClock.Now));
    }

    [Fact]
    public void EventFieldDefinitionCreate_LabelOrOptionWithNul_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("side", WithNul, EventFieldKind.Text));
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("side", "Side", EventFieldKind.Select, options: ["left", WithNul]));
    }

    [Fact]
    public void Text_NulIsNotTrimmedAway_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Baby.Create("Lia\0", TestClock.Today, Guid.NewGuid(), TestClock.Now));
    }

    [Theory]
    [InlineData("10000000")]
    [InlineData("9999999.9995")]
    [InlineData("79228162514264337593543950335")]
    public void DosageCreate_AmountAboveColumnLimit_ThrowsValidation(string amount)
    {
        var exception = Assert.Throws<DomainValidationException>(() => Dosage.Create(decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture), "ml"));

        Assert.Equal("Amount", exception.Field);
    }

    [Fact]
    public void DosageCreate_MaxAmount_IsAccepted()
    {
        Assert.Equal(Dosage.MaxAmount, Dosage.Create(Dosage.MaxAmount, "ml").Amount);
    }

    [Fact]
    public void DosageCreate_MoreThanThreeDecimals_RoundsToColumnScale()
    {
        Assert.Equal(2.346m, Dosage.Create(2.3455m, "ml").Amount);
    }

    [Fact]
    public void DosageCreate_AmountRoundingToZero_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Dosage.Create(0.0004m, "ml"));
    }

    [Theory]
    [InlineData("""{"note":"a\u0000b"}""")]
    [InlineData("""{"a\u0000":1}""")]
    [InlineData("""{"nested":{"list":[1,{"deep":"\u0000"}]}}""")]
    public void PayloadFrom_NulInStringOrMemberName_ThrowsValidation(string json)
    {
        var exception = Assert.Throws<DomainValidationException>(() => EventPayload.From(json));

        Assert.Equal("Payload", exception.Field);
    }

    [Theory]
    [InlineData("""{"text":"\ud800"}""")]
    [InlineData("""{"\udc00":1}""")]
    public void PayloadFrom_LoneSurrogate_ThrowsValidation(string json)
    {
        Assert.Throws<DomainValidationException>(() => EventPayload.From(json));
    }

    [Theory]
    [InlineData("""{"n":1e1001}""")]
    [InlineData("""{"n":1E-1001}""")]
    [InlineData("""{"n":1e99999999999}""")]
    [InlineData("""{"n":[12345678901234567890123456789012345678901234567890123456789012345]}""")]
    public void PayloadFrom_NumberPostgresCannotStore_ThrowsValidation(string json)
    {
        Assert.Throws<DomainValidationException>(() => EventPayload.From(json));
    }

    [Theory]
    [InlineData("""{"n":1e1000,"m":-2.5E-1000,"o":0.125,"p":-7}""")]
    [InlineData("""{"text":"😀 ok","flag":true,"none":null}""")]
    public void PayloadFrom_StorableValues_IsAccepted(string json)
    {
        Assert.Equal(json, EventPayload.From(json).Value);
    }

    [Fact]
    public void PayloadRehydrate_StoredNumberRenderedLong_IsNotRevalidated()
    {
        var stored = "{\"n\":1" + new string('0', 100) + "}";

        Assert.Equal(stored, EventPayload.Rehydrate(stored).Value);
    }
}
