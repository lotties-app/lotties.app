using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Catalog.Official.Verification;

namespace Lotties.Domain.Tests.Catalog;

/// <summary>The curated-list verifier against small synthetic official rows (never the real ANVISA files).</summary>
public sealed class CuratedVerificationTests
{
    private const string DropsPresentation = "75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML";

    private static AnvisaRegistrationDetail Row(string name, string registration, string ingredients, string status = "Ativo", string category = "Novo") =>
        new(name, registration, status, ingredients, "60659463000191 - ACME FARMA LTDA", category);

    private static CmedPresentationDetail Cmed(string registration, string presentation, string substance = "SIMETICONA") =>
        new(registration, "X", presentation, substance);

    private static CuratedProductEntry Entry(string id, string name, string[] ingredients, ProductForm form = ProductForm.Drops, string? route = "oral", string? officialName = null, string? registration = null, AnvisaCheck? check = null) =>
        new(id, name, form, ingredients, Reviewed: false, Basis: "synthetic", OfficialName: officialName, Registration: registration, Route: route, AnvisaCheck: check);

    private static readonly IReadOnlyList<AnvisaRegistrationDetail> Registrations =
    [
        Row("FAKEFLAT", "100000001", "SIMETICONA"),
        Row("CAFÉ CALM", "100000002", "CLORETO DE SODIO"),
        Row("OLDGAS", "100000003", "simeticona", status: "Inativo"),
        Row("OLDPAIN", "100000004", "dipirona", status: "Inativo"),
        Row("TWINNAME", "100000005", "simeticona"),
        Row("TWINNAME", "100000006", "dipirona"),
        Row("NOTIFIED SALINE", string.Empty, string.Empty, category: "BAIXO RISCO"),
        Row("SORINE", "100000007", "cloridrato de nafazolina"),
        Row("SORINE", string.Empty, string.Empty, category: "BAIXO RISCO"),
        Row("PAINFREE", "100000008", "dipirona"),
        Row("SIMETICONA GENERICA", "100000009", "simeticona"),
        Row("SIMETICONA GENERICA", "100000009", "simeticona", status: "Inativo"),
    ];

    private static readonly IReadOnlyList<CmedPresentationDetail> Presentations =
    [
        Cmed("1000000010011", DropsPresentation),
        Cmed("1000000020022", "9 MG/ML SOL NAS CT FR PLAS OPC SPRAY X 30 ML", "CLORETO DE SODIO"),
        Cmed("1000000080088", DropsPresentation, "DIPIRONA"),
        Cmed("1000000090099", DropsPresentation),
    ];

    private static CuratedVerifier Verifier => new(Registrations, Presentations, OfficialData.Dictionary);

    private static EntryVerification Verify(CuratedProductEntry entry) => Verifier.Verify(entry);

    [Fact]
    public void Verify_ActiveRegistrationThatAgrees_IsVerifiedWithTheRegistrationAsEvidence()
    {
        var result = Verify(Entry("fakeflat-drops", "Fakeflat", ["simeticona"]));

        Assert.Equal(VerificationStatus.Verified, result.Status);
        Assert.Empty(result.Diffs);
        Assert.Equal(["100000001"], result.Evidence.Select(product => product.Reference));
        Assert.Equal(["drops"], result.Evidence[0].Forms);
        Assert.Equal(["oral"], result.Evidence[0].Routes);
        Assert.Equal(["75 MG/ML"], result.Evidence[0].Strengths);
    }

    [Theory]
    [InlineData("CAFE CALM", "cloreto de sódio")]
    [InlineData("café calm", "CLORETO DE SÓDIO")]
    [InlineData("  Café   Calm ", "Cloreto de Sodio")]
    public void Verify_IgnoresCaseAccentsAndSpacingOfNamesAndIngredients(string name, string ingredient)
    {
        var result = Verify(Entry("cafe-calm-spray", name, [ingredient], ProductForm.Spray, "nasal"));

        Assert.Equal(VerificationStatus.Verified, result.Status);
        Assert.Equal(["100000002"], result.Evidence.Select(product => product.Reference));
    }

    [Fact]
    public void Verify_DifferentIngredient_IsAMismatchWithTheFieldDiff()
    {
        var result = Verify(Entry("painfree-drops", "Painfree", ["simeticona"]));

        Assert.Equal(VerificationStatus.Mismatch, result.Status);
        var diff = Assert.Single(result.Diffs);
        Assert.Equal(("ingredients", "simeticona", "dipirona"), (diff.Field, diff.Entry, diff.Official));
    }

    [Fact]
    public void Verify_AdditionalOrMissingIngredient_IsAMismatch()
    {
        var result = Verify(Entry("fakeflat-drops", "Fakeflat", ["simeticona", "cafeína"]));

        Assert.Equal(VerificationStatus.Mismatch, result.Status);
        Assert.Equal("simeticona + cafeína", result.Diffs[0].Entry);
    }

    [Fact]
    public void Verify_SameIngredientButOtherFormOrRoute_IsAMismatchOnThoseFields()
    {
        var result = Verify(Entry("fakeflat-tablet", "Fakeflat", ["simeticona"], ProductForm.Tablet, "nasal"));

        Assert.Equal(VerificationStatus.Mismatch, result.Status);
        Assert.Equal(["form", "route"], result.Diffs.Select(diff => diff.Field));
        Assert.Equal(["drops"], [result.Diffs[0].Official]);
    }

    [Fact]
    public void Verify_NoOfficialRecordWithThatExactName_IsNotFoundAndSaysItMayBeExempt()
    {
        var result = Verify(Entry("probio-drops", "Zzprobio", ["simeticona"]));

        Assert.Equal(VerificationStatus.NotFound, result.Status);
        Assert.Empty(result.Evidence);
        Assert.Contains(result.Notes, note => note.Contains("exempt", StringComparison.Ordinal));
        Assert.Empty(result.RelatedOfficialNames);
    }

    [Fact]
    public void Verify_NotFound_ListsOfficialNamesThatOnlyStartTheSameAsRelatedNeverAsEvidence()
    {
        var result = Verify(Entry("fake-drops", "Fake", ["simeticona"]));

        Assert.Equal(VerificationStatus.NotFound, result.Status);
        Assert.Equal(["FAKEFLAT"], result.RelatedOfficialNames);
        Assert.Empty(result.Evidence);
    }

    [Fact]
    public void Verify_SeveralActiveProductsWithDifferentIngredientsUnderTheName_IsAmbiguous()
    {
        var result = Verify(Entry("twin-drops", "Twinname", ["simeticona"]));

        Assert.Equal(VerificationStatus.Ambiguous, result.Status);
        Assert.Equal(["100000005", "100000006"], result.Evidence.Select(product => product.Reference).Order());
    }

    [Fact]
    public void Verify_NameSharedByANaphazolineRegistrationAndAnUnlistedNotifiedProduct_IsAmbiguous()
    {
        var result = Verify(Entry("sorine-saline-drops", "Sorine Solução Nasal Salina", ["cloreto de sódio"], ProductForm.Drops, "nasal", officialName: "Sorine"));

        Assert.Equal(VerificationStatus.Ambiguous, result.Status);
        Assert.Contains(result.Evidence, product => product.Ingredients.SequenceEqual(["cloridrato de nafazolina"]));
        Assert.Contains(result.Notes, note => note.Contains("Looked up under the official name", StringComparison.Ordinal));
    }

    [Fact]
    public void Verify_OnlyInactiveRegistrationWithTheSameIngredient_IsCancelled()
    {
        var result = Verify(Entry("oldgas-drops", "Oldgas", ["simeticona"]));

        Assert.Equal(VerificationStatus.Cancelled, result.Status);
        Assert.Empty(result.Diffs);
    }

    [Fact]
    public void Verify_OnlyInactiveRegistrationWithAnotherIngredient_IsAMismatchNotJustCancelled()
    {
        var result = Verify(Entry("oldpain-drops", "Oldpain", ["simeticona"]));

        Assert.Equal(VerificationStatus.Mismatch, result.Status);
        Assert.Contains(result.Notes, note => note.Contains("DIFFER", StringComparison.Ordinal));
    }

    [Fact]
    public void Verify_ActiveNotifiedProductWithoutAListedIngredient_IsUnverifiableNotVerified()
    {
        var result = Verify(Entry("saline-spray", "Saline Solução Nasal Salina", ["cloreto de sódio"], ProductForm.Spray, "nasal", officialName: "Notified Saline"));

        Assert.Equal(VerificationStatus.Unverifiable, result.Status);
        Assert.Equal(["notified:NOTIFIED SALINE"], result.Evidence.Select(product => product.Reference));
    }

    [Fact]
    public void Verify_EntryWithoutIngredients_IsUnverifiableWithoutThrowing()
    {
        var result = Verify(Entry("empty-drops", "Fakeflat", []));

        Assert.Equal(VerificationStatus.Unverifiable, result.Status);
        Assert.Empty(result.EntryIngredientKeys);
    }

    [Fact]
    public void Verify_RegistrationNumberWinsOverTheName()
    {
        var result = Verify(Entry("any-drops", "Another Display Name", ["simeticona"], registration: "1.0000.0001"));

        Assert.Equal(VerificationStatus.Verified, result.Status);
        Assert.Contains(result.Notes, note => note.Contains("100000001", StringComparison.Ordinal));
    }

    [Fact]
    public void Verify_UnknownRegistration_IsNotFound()
    {
        Assert.Equal(VerificationStatus.NotFound, Verify(Entry("x-drops", "Fakeflat", ["simeticona"], registration: "999999999")).Status);
    }

    [Fact]
    public void Verify_RegistrationWithActiveAndInactiveRowsCountsAsActive()
    {
        Assert.Equal(VerificationStatus.Verified, Verify(Entry("generic-drops", "Simeticona Generica", ["simeticona"])).Status);
    }

    private static CuratedVerificationReport Run(params CuratedProductEntry[] entries)
    {
        var plan = OfficialCatalogPlanner.Plan(Registrations.Select(row => row.ToRow()).ToArray(), Presentations.Select(row => row.ToRow()).ToArray(), OfficialData.Dictionary);
        return CuratedVerificationRunner.Run(entries, Verifier, OfficialData.Dictionary, plan, new DateOnly(2026, 10, 23));
    }

    [Fact]
    public void Run_CuratedNameEqualToAnOfficialProductWithOtherIngredients_IsACollisionError()
    {
        var report = Run(Entry("sorine-wrong", "Sorine", ["cloreto de sódio"], ProductForm.Spray, "nasal"));

        var finding = Assert.Single(report.Findings, finding => finding.Code == "NAME_COLLISION");
        Assert.Equal(FindingSeverity.Error, finding.Severity);
        Assert.True(report.HasFailures);
    }

    [Fact]
    public void Run_SalineEntryWithADistinctNameDoesNotCollideWithTheNaphazolineSorine()
    {
        var report = Run(Entry("sorine-saline-spray", "Sorine Solução Nasal Salina", ["cloreto de sódio"], ProductForm.Spray, "nasal", officialName: "Notified Saline"));

        Assert.DoesNotContain(report.Findings, finding => finding.Code.StartsWith("NAME_", StringComparison.Ordinal));
        Assert.False(report.HasFailures);
    }

    [Fact]
    public void Run_NameSharedWithAnActiveUnlistedProduct_IsOnlyAWarning()
    {
        var report = Run(Entry("notified-saline", "Notified Saline", ["cloreto de sódio"], ProductForm.Spray, "nasal"));

        var finding = Assert.Single(report.Findings, finding => finding.Code == "NAME_SHARED_WITH_UNLISTED");
        Assert.Equal(FindingSeverity.Warning, finding.Severity);
        Assert.False(report.HasFailures);
    }

    [Fact]
    public void Run_EmptyIngredientEntry_IsAnErrorAndDoesNotBreakTheRest()
    {
        var report = Run(Entry("empty-drops", "Emptyname", []), Entry("fakeflat-drops", "Fakeflat", ["simeticona"]));

        Assert.Contains(report.Findings, finding => finding is { Code: "EMPTY_INGREDIENTS", Severity: FindingSeverity.Error });
        Assert.Equal(VerificationStatus.Verified, report.Entries[1].Status);
        Assert.True(report.HasFailures);
    }

    [Fact]
    public void Run_DuplicateIdsAndDuplicateNameFormPairs_AreErrors()
    {
        var report = Run(
            Entry("same-id", "Fakeflat", ["simeticona"]),
            Entry("same-id", "Another", ["simeticona"]),
            Entry("dup-a", "Dupe Name", ["simeticona"]),
            Entry("dup-b", "dupe  name", ["simeticona"]));

        Assert.Contains(report.Findings, finding => finding.Code == "DUPLICATE_ID");
        Assert.Contains(report.Findings, finding => finding.Code == "DUPLICATE_NAME");
    }

    [Fact]
    public void Run_UnmappedIngredient_IsAWarning()
    {
        var report = Run(Entry("probio-drops", "Probio", ["lactobacillus fantasticus"]));

        Assert.Contains(report.Findings, finding => finding is { Code: "UNMAPPED_INGREDIENT", Severity: FindingSeverity.Warning });
    }

    [Fact]
    public void Run_SameGenericIngredientUnderTwoSubstanceKeys_IsAnEquivalenceError()
    {
        var dictionary = SubstanceDictionary.Create(
        [
            new CuratedSubstance("simethicone", "Simethicone", "Simeticona", ["simeticona"], []),
            new CuratedSubstance("simethicone_alt", "Simethicone", "Simeticona", ["simeticone"], []),
        ]);
        var verifier = new CuratedVerifier([], [], dictionary);
        var entries = new[] { Entry("a-drops", "Aname", ["simeticona"]), Entry("b-drops", "Bname", ["simeticone"]) };
        var plan = OfficialCatalogPlanner.Plan([], [], dictionary);

        var report = CuratedVerificationRunner.Run(entries, verifier, dictionary, plan, new DateOnly(2026, 10, 23));

        Assert.Contains(report.Findings, finding => finding is { Code: "EQUIVALENCE_SPLIT", Severity: FindingSeverity.Error });
    }

    [Fact]
    public void Run_SameIngredientSetSpelledTwoWays_IsAWarningNotAnError()
    {
        var report = Run(Entry("a-drops", "Aname", ["dipirona"]), Entry("b-drops", "Bname", ["dipirona sódica"]));

        Assert.Contains(report.Findings, finding => finding is { Code: "INGREDIENT_SPELLING_VARIES", Severity: FindingSeverity.Warning });
        Assert.DoesNotContain(report.Findings, finding => finding.Code == "EQUIVALENCE_SPLIT");
    }

    [Fact]
    public void Run_RecordedVerifiedCheckThatNoLongerHolds_IsAnError_AndARecordedNonVerifiedOneAWarning()
    {
        var stale = new AnvisaCheck("2026-01-01", "VERIFIED", ["100000001"]);
        var old = new AnvisaCheck("2026-01-01", "NOT_FOUND", []);

        var report = Run(
            Entry("probio-drops", "Probio", ["simeticona"], check: stale),
            Entry("fakeflat-drops", "Fakeflat", ["simeticona"], check: old));

        Assert.Contains(report.Findings, finding => finding is { Code: "STALE_CHECK", Severity: FindingSeverity.Error } && finding.EntryIds[0] == "probio-drops");
        Assert.Contains(report.Findings, finding => finding is { Code: "STALE_CHECK", Severity: FindingSeverity.Warning } && finding.EntryIds[0] == "fakeflat-drops");
    }

    [Fact]
    public void Run_BasisThatCitesARegistration_ReportsWhatTheOfficialDataSaysAboutIt()
    {
        var entry = Entry("fakeflat-drops", "Fakeflat", ["simeticona"]) with { Basis = "Registration 1.0000.0001 and 1.9999.9999, presentation 1000000010011." };

        var report = Run(entry);

        Assert.Contains(report.Findings, finding => finding.Code == "BASIS_REGISTRATION" && finding.Message.Contains("100000001", StringComparison.Ordinal) && finding.Message.Contains("FAKEFLAT", StringComparison.Ordinal));
        Assert.Contains(report.Findings, finding => finding.Code == "BASIS_REGISTRATION_UNKNOWN" && finding.Message.Contains("199999999", StringComparison.Ordinal));
    }

    [Fact]
    public void Run_SuggestionsOfAVerifiedEntry_AgreeWithTheOfficialSiblings()
    {
        var report = Run(Entry("fakeflat-drops", "Fakeflat", ["simeticona"]));

        var sibling = Assert.Single(report.Alternatives, alternative => alternative.AlternativeName == "Simeticona Generica");
        Assert.Equal((AlternativeCheck.Agrees, "official"), (sibling.Outcome, sibling.AlternativeSource));
        Assert.DoesNotContain(report.Alternatives, alternative => alternative.Outcome == AlternativeCheck.Differs);
    }

    [Fact]
    public void Run_SuggestionOfAnEntryWhoseOfficialIngredientDiffers_IsFlagged()
    {
        var report = Run(Entry("painfree-drops", "Painfree", ["simeticona"]));

        var differing = report.Alternatives.Where(alternative => alternative.Outcome == AlternativeCheck.Differs).ToArray();
        Assert.NotEmpty(differing);
        Assert.All(differing, alternative => Assert.Contains("differ", alternative.Detail, StringComparison.Ordinal));
        Assert.True(report.HasFailures);
    }

    [Fact]
    public void Run_SuggestionsOfAnEntryThatCannotBeVerified_AreMarkedUnverifiedNotAgreed()
    {
        var report = Run(Entry("probio-drops", "Probio", ["simeticona"]));

        Assert.NotEmpty(report.Alternatives);
        Assert.All(report.Alternatives, alternative => Assert.Equal(AlternativeCheck.Unverified, alternative.Outcome));
        Assert.False(report.HasFailures);
    }

    [Fact]
    public void Run_TwoCuratedEntriesWithTheSameIngredient_SuggestEachOtherAndFlagAFormDifference()
    {
        var report = Run(Entry("a-drops", "Aname", ["simeticona"]), Entry("b-tablet", "Bname", ["simeticona"], ProductForm.Tablet));

        var pair = Assert.Single(report.Alternatives, alternative => alternative is { EntryId: "a-drops", AlternativeName: "Bname" });
        Assert.Equal("curated", pair.AlternativeSource);
        Assert.False(pair.SameForm);
    }

    [Theory]
    [InlineData("75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML", "75 MG/ML")]
    [InlineData("10 MG/G + 0,443 MG/G CREM DERM CT BG AL X 40 G", "10 MG/G + 0,443 MG/G")]
    [InlineData("0,9 % SOL NAS CT FR", "0,9 %")]
    [InlineData("SOL OR", "")]
    public void Strength_ReadsTheLeadingStrengthOfAPresentation(string presentation, string expected)
    {
        Assert.Equal(expected, CuratedVerifier.Strength(presentation));
    }
}
