using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Tests.Vaccinations;

/// <summary>The recorded vaccine: terms, the no-future rule, last write wins, soft delete, and the baby's vaccine profile.</summary>
public sealed class VaccinationTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private static VaccinationTerms Terms(string? lot = "L1", string givenOn = "2026-01-05") =>
        VaccinationTerms.Create("bcg", "bcg-1", null, "  Dose única ", DateOnly.Parse(givenOn), VaccineNetwork.Public, "UBS", lot, null, " ");

    [Fact]
    public void Create_TrimsTextAndDropsBlankOptionalText()
    {
        var terms = Terms();

        Assert.Equal(("Dose única", null), (terms.DoseLabel, terms.Notes));
    }

    [Theory]
    [InlineData(null, null, null, "customName")]
    [InlineData("bcg", null, "BCG", "customName")]
    [InlineData(null, "bcg-1", "x", "doseId")]
    [InlineData("BCG", null, null, "vaccineKey")]
    [InlineData("bcg", "bcg 1", null, "doseId")]
    public void Create_InvalidNaming_NamesTheField(string? vaccineKey, string? doseId, string? customName, string field)
    {
        var error = Assert.Throws<DomainValidationException>(() =>
            VaccinationTerms.Create(vaccineKey, doseId, customName, null, new DateOnly(2026, 1, 1), VaccineNetwork.Public, null, null, null, null));

        Assert.Equal(field, error.Field);
    }

    [Fact]
    public void Create_GivenAfterTomorrowInUtc_IsRefused()
    {
        var accepted = Vaccination.Create(Guid.NewGuid(), BabyId, Terms(givenOn: "2026-01-11"), UserId, Now);

        var error = Assert.Throws<DomainValidationException>(() => Vaccination.Create(Guid.NewGuid(), BabyId, Terms(givenOn: "2026-01-12"), UserId, Now));

        Assert.Equal(new DateOnly(2026, 1, 11), accepted.GivenOn);
        Assert.Equal("givenOn", error.Field);
    }

    [Fact]
    public void DecideUpsert_OlderClientTimeLoses_TiesApply_AnotherBabyThrows()
    {
        var vaccination = Vaccination.Create(Guid.NewGuid(), BabyId, Terms(), UserId, Now, Now.AddMinutes(-10));

        Assert.Equal(VaccinationUpsertDecision.IgnoreStale, vaccination.DecideUpsert(BabyId, Now.AddMinutes(-11), Now));
        Assert.Equal(VaccinationUpsertDecision.Apply, vaccination.DecideUpsert(BabyId, Now.AddMinutes(-10), Now));
        Assert.Throws<VaccinationBabyMismatchException>(() => vaccination.DecideUpsert(Guid.NewGuid(), Now, Now));
    }

    [Fact]
    public void Edit_SameTermsChangeNothing_NewTermsStampTheTimes()
    {
        var vaccination = Vaccination.Create(Guid.NewGuid(), BabyId, Terms(), UserId, Now);

        vaccination.Edit(Terms(), Now.AddHours(1), Now.AddHours(1));
        var unchanged = vaccination.UpdatedAt;
        vaccination.Edit(Terms(lot: "L2"), Now.AddHours(2), Now.AddHours(2));

        Assert.Equal(Now, unchanged);
        Assert.Equal(("L2", Now.AddHours(2)), (vaccination.Lot, vaccination.UpdatedAt));
    }

    [Fact]
    public void SoftDelete_IsIdempotentAndFinal()
    {
        var vaccination = Vaccination.Create(Guid.NewGuid(), BabyId, Terms(), UserId, Now);

        vaccination.SoftDelete(Now.AddHours(1));
        vaccination.SoftDelete(Now.AddHours(2));
        vaccination.Edit(Terms(lot: "L9"), Now.AddHours(3), Now.AddHours(3));

        Assert.Equal((Now.AddHours(1), Now.AddHours(1), "L1"), (vaccination.DeletedAt, vaccination.UpdatedAt, vaccination.Lot));
        Assert.Equal(VaccinationUpsertDecision.IgnoreDeleted, vaccination.DecideUpsert(BabyId, Now.AddHours(4), Now.AddHours(4)));
    }

    [Fact]
    public void BabyVaccineProfile_DefaultsToPublicAndIsReplaced()
    {
        var baby = Baby.Create("Lia", new DateOnly(2026, 1, 1), UserId, Now);

        var before = baby.VaccineProfile;
        baby.UpdateVaccineProfile(VaccineProfile.Create(VaccineCoverage.PublicAndPrivate, 34, RsvMaternalVaccination.No));

        Assert.Equal(VaccineProfile.Default, before);
        Assert.Equal((VaccineCoverage.PublicAndPrivate, 34, RsvMaternalVaccination.No, true), (baby.VaccineProfile.Coverage, baby.VaccineProfile.GestationalAgeWeeks, baby.VaccineProfile.RsvMaternalVaccination, baby.VaccineProfile.IsPremature));
    }

    [Theory]
    [InlineData(19)]
    [InlineData(45)]
    public void VaccineProfile_GestationalAgeOutOfRange_IsRefused(int weeks)
    {
        var error = Assert.Throws<DomainValidationException>(() => VaccineProfile.Create(VaccineCoverage.Public, weeks, null));

        Assert.Equal("gestationalAgeWeeks", error.Field);
    }

    [Fact]
    public void VaccineProfile_Codes_RoundTrip()
    {
        Assert.Equal(VaccineCoverage.PublicAndPrivate, VaccineProfile.CoverageOf(VaccineProfile.CodeOf(VaccineCoverage.PublicAndPrivate)));
        Assert.Equal("public", VaccineProfile.CodeOf(VaccineCoverage.Public));
        Assert.Throws<DomainValidationException>(() => VaccineProfile.CoverageOf("private"));
    }
}
