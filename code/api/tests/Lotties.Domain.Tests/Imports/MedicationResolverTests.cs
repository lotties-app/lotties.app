using Lotties.Domain.Exceptions;
using Lotties.Domain.Imports;
using Lotties.Domain.Medications;
using static Lotties.Domain.Tests.Imports.ImportTestData;

namespace Lotties.Domain.Tests.Imports;

public sealed class MedicationResolverTests
{
    [Fact]
    public void Resolve_ExistingMapping_ReturnsCatalogMedicationMatchingTokenIgnoringCase()
    {
        var colidis = CatalogMedication("Colidis");
        var resolver = Resolver([colidis], new MedicationMapping("colidis", MedicationMappingAction.Existing, colidis.Id, null));

        var resolution = resolver.Resolve(["COLÍDIS"]);

        Assert.Equal([new ImportedMedication(colidis.Id, "Colidis")], resolution.Medications);
        Assert.Empty(resolution.Unmapped);
    }

    [Fact]
    public void Resolve_TokenWithoutMapping_IsReportedAsUnmapped()
    {
        var resolution = Resolver().Resolve(["Flagas"]);

        Assert.Empty(resolution.Medications);
        Assert.Equal(["Flagas"], resolution.Unmapped);
    }

    [Fact]
    public void Resolve_IgnoredToken_IsLeftOutAndNotUnmapped()
    {
        var resolution = Resolver(null, new MedicationMapping("Agua", MedicationMappingAction.Ignore, null, null)).Resolve(["Agua"]);

        Assert.Empty(resolution.Medications);
        Assert.Empty(resolution.Unmapped);
    }

    [Fact]
    public void Resolve_TyposCreatedWithTheSameName_ShareOneNewMedication()
    {
        var resolver = Resolver(
            null,
            new MedicationMapping("Flagas", MedicationMappingAction.Create, null, "Flagyl"),
            new MedicationMapping("Flygas", MedicationMappingAction.Create, null, "flagyl"));

        var resolution = resolver.Resolve(["Flagas", "Flygas"]);

        var single = Assert.Single(resolution.Medications);
        Assert.Equal(ImportIds.Medication(BabyId, "flagyl"), single.MedicationId);
        Assert.Equal("Flagyl", single.Name);
        Assert.Single(resolver.MedicationsToCreate(resolution.Medications));
    }

    [Fact]
    public void Resolve_CreateWithNameOfACatalogEntry_ReusesTheEntry()
    {
        var puravit = CatalogMedication("Puravit");
        var resolver = Resolver([puravit], new MedicationMapping("Puravit gotas", MedicationMappingAction.Create, null, "PURAVIT"));

        var resolution = resolver.Resolve(["Puravit gotas"]);

        Assert.Equal(puravit.Id, Assert.Single(resolution.Medications).MedicationId);
        Assert.Empty(resolver.MedicationsToCreate(resolution.Medications));
    }

    [Fact]
    public void Resolve_CreateWhoseDerivedIdIsInTheCatalogUnderANewName_ReusesThatMedication()
    {
        var imported = Medication.Create(ImportIds.Medication(BabyId, "puravit"), BabyId, "Puravit", null, null, isUsual: false, TestClock.Now);
        imported.Edit("Puravit gotas (renamed)", null, null, isUsual: true);
        var resolver = Resolver([imported], new MedicationMapping("Puravit", MedicationMappingAction.Create, null, "Puravit"));

        var resolution = resolver.Resolve(["Puravit"]);

        Assert.Equal(new ImportedMedication(imported.Id, "Puravit gotas (renamed)"), Assert.Single(resolution.Medications));
        Assert.Empty(resolver.MedicationsToCreate(resolution.Medications));
    }

    [Fact]
    public void Resolve_CreateMatchingBothADerivedIdAndAnotherEntryByName_PrefersTheDerivedId()
    {
        var imported = Medication.Create(ImportIds.Medication(BabyId, "puravit"), BabyId, "Renamed", null, null, isUsual: false, TestClock.Now);
        var resolver = Resolver([CatalogMedication("Puravit"), imported], new MedicationMapping("Puravit", MedicationMappingAction.Create, null, "Puravit"));

        Assert.Equal(imported.Id, Assert.Single(resolver.Resolve(["Puravit"]).Medications).MedicationId);
    }

    [Fact]
    public void MedicationsToCreate_OnlyIncludesUsedMedications()
    {
        var resolver = Resolver(null, new MedicationMapping("Flagas", MedicationMappingAction.Create, null, "Flagyl"));

        Assert.Empty(resolver.MedicationsToCreate([]));
    }

    [Fact]
    public void Create_ExistingMappingOutsideTheCatalog_Throws()
    {
        var exception = Assert.Throws<InvalidMedicationMappingException>(() =>
            Resolver([CatalogMedication("Colidis")], new MedicationMapping("Colidis", MedicationMappingAction.Existing, Guid.NewGuid(), null)));

        Assert.Equal("Colidis", exception.Token);
        Assert.Equal("import_invalid_medication_mapping", exception.Code);
    }

    [Fact]
    public void Create_CreateWithoutName_Throws()
    {
        Assert.Throws<InvalidMedicationMappingException>(() => Resolver(null, new MedicationMapping("Flagas", MedicationMappingAction.Create, null, " ")));
    }

    [Fact]
    public void Create_CreateWithTooLongName_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Resolver(null, new MedicationMapping("Flagas", MedicationMappingAction.Create, null, new string('x', 101))));
    }

    [Fact]
    public void Create_SameTokenMappedDifferently_Throws()
    {
        Assert.Throws<InvalidMedicationMappingException>(() => Resolver(
            null,
            new MedicationMapping("Flagas", MedicationMappingAction.Ignore, null, null),
            new MedicationMapping("flagas", MedicationMappingAction.Create, null, "Flagyl")));
    }

    [Fact]
    public void Create_SameTokenMappedTwiceIdentically_IsAccepted()
    {
        var resolver = Resolver(
            null,
            new MedicationMapping("Flagas", MedicationMappingAction.Ignore, null, null),
            new MedicationMapping("FLAGAS", MedicationMappingAction.Ignore, null, null));

        Assert.True(resolver.IsMapped("flagas"));
    }
}
