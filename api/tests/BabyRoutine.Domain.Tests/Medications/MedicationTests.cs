using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Domain.Tests.Medications;

public sealed class MedicationTests
{
    private static readonly Guid BabyId = Guid.NewGuid();

    [Fact]
    public void Create_Valid_SetsProperties()
    {
        var dosage = Dosage.Create(2.5m, "ml");

        var medication = Medication.Create(BabyId, " Paracetamol ", dosage, " after meals ", isUsual: true, TestClock.Now);

        Assert.Equal(("Paracetamol", dosage, "after meals", true), (medication.Name, medication.DefaultDosage, medication.Notes, medication.IsUsual));
        Assert.Equal(BabyId, medication.BabyId);
    }

    [Fact]
    public void Create_WithoutDosage_IsAllowed()
    {
        var medication = Medication.Create(BabyId, "Simethicone", null, null, isUsual: false, TestClock.Now);

        Assert.Null(medication.DefaultDosage);
    }

    [Fact]
    public void Create_BlankName_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Medication.Create(BabyId, " ", null, null, isUsual: false, TestClock.Now));
    }

    [Fact]
    public void Create_EmptyBaby_ThrowsArgument()
    {
        Assert.Throws<ArgumentException>(() => Medication.Create(Guid.Empty, "Simethicone", null, null, isUsual: false, TestClock.Now));
    }

    [Fact]
    public void UpdateDetails_InvalidNotes_ThrowsAndKeepsState()
    {
        var medication = Medication.Create(BabyId, "Simethicone", null, null, isUsual: false, TestClock.Now);

        Assert.Throws<DomainValidationException>(
            () => medication.UpdateDetails("Other", null, new string('n', Medication.NotesMaxLength + 1)));
        Assert.Equal("Simethicone", medication.Name);
    }

    [Fact]
    public void MarkAndUnmarkAsUsual_TogglesFlag()
    {
        var medication = Medication.Create(BabyId, "Simethicone", null, null, isUsual: false, TestClock.Now);

        medication.MarkAsUsual();
        var marked = medication.IsUsual;
        medication.UnmarkAsUsual();

        Assert.Equal((true, false), (marked, medication.IsUsual));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void DosageCreate_NonPositiveAmount_ThrowsValidation(int amount)
    {
        Assert.Throws<DomainValidationException>(() => Dosage.Create(amount, "ml"));
    }

    [Fact]
    public void DosageCreate_BlankUnit_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Dosage.Create(1, " "));
    }

    [Fact]
    public void Dosage_SameValues_AreEqual()
    {
        Assert.Equal(Dosage.Create(1.5m, "ml"), Dosage.Create(1.5m, "ml"));
    }
}
