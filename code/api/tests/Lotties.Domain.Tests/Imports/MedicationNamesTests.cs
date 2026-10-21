using Lotties.Domain.Imports;

namespace Lotties.Domain.Tests.Imports;

public sealed class MedicationNamesTests
{
    [Theory]
    [InlineData("Colidis e Puravit", new[] { "Colidis", "Puravit" })]
    [InlineData("Colicaliv e flagas", new[] { "Colicaliv", "flagas" })]
    [InlineData("Colidis, Puravit + Flagyl / Simeticona", new[] { "Colidis", "Puravit", "Flagyl", "Simeticona" })]
    [InlineData("Colidis and Puravit & Flagyl.", new[] { "Colidis", "Puravit", "Flagyl" })]
    [InlineData("Colidis E puravit", new[] { "Colidis", "puravit" })]
    [InlineData("  Colidis  ", new[] { "Colidis" })]
    [InlineData("Colidis e colidis", new[] { "Colidis" })]
    [InlineData("Vitamina D\ncolidis", new[] { "Vitamina D", "colidis" })]
    [InlineData("Eritromicina", new[] { "Eritromicina" })]
    public void Split_Comment_ReturnsTrimmedDistinctNames(string comment, string[] expected)
    {
        Assert.Equal(expected, MedicationTokenizer.Split(comment));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" , + ")]
    public void Split_NoNames_ReturnsEmpty(string? comment)
    {
        Assert.Empty(MedicationTokenizer.Split(comment));
    }

    [Theory]
    [InlineData("Colídis", "colidis")]
    [InlineData("  Vitamina   D ", "vitamina d")]
    [InlineData("SIMETICONA", "simeticona")]
    public void Normalize_IgnoresCaseDiacriticsAndExtraSpaces(string name, string expected)
    {
        Assert.Equal(expected, MedicationNameMatcher.Normalize(name));
    }

    [Theory]
    [InlineData("flagas", "flygas", 1)]
    [InlineData("flagas", "flagyl", 2)]
    [InlineData("", "abc", 3)]
    [InlineData("same", "same", 0)]
    public void Distance_ReturnsLevenshteinDistance(string left, string right, int expected)
    {
        Assert.Equal(expected, MedicationNameMatcher.Distance(left, right));
    }

    [Theory]
    [InlineData("flagas", "flygas", 2, 1)]
    [InlineData("flagas", "flagyl", 1, 2)]
    [InlineData("abc", "abcdef", 2, 3)]
    [InlineData("kitten", "sitting", 3, 3)]
    [InlineData("kitten", "sitting", 2, 3)]
    [InlineData("", "", 0, 0)]
    public void Distance_Bounded_ReturnsDistanceOrBoundPlusOne(string left, string right, int maxDistance, int expected)
    {
        Assert.Equal(expected, MedicationNameMatcher.Distance(left, right, maxDistance));
    }

    [Fact]
    public void Distance_Bounded_AgreesWithTheFullDistanceWithinTheBound()
    {
        var random = new Random(7);
        var names = Enumerable.Range(0, 300).Select(_ => RandomName(random)).ToArray();

        var disagreements = names.Zip(names.Skip(1))
            .SelectMany(pair => Enumerable.Range(0, 4).Select(bound => (pair.First, pair.Second, bound)))
            .Where(item => MedicationNameMatcher.Distance(item.First, item.Second, item.bound) != Math.Min(MedicationNameMatcher.Distance(item.First, item.Second), item.bound + 1))
            .ToArray();

        Assert.Empty(disagreements);
    }

    [Fact]
    public void Distance_NegativeBound_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => MedicationNameMatcher.Distance("a", "b", -1));
    }

    [Fact]
    public void FindBestMatch_EqualIgnoringCaseAndDiacritics_MatchesWithDistanceZero()
    {
        var colidis = ImportTestData.CatalogMedication("Colídis");

        var match = MedicationNameMatcher.FindBestMatch("COLIDIS", [ImportTestData.CatalogMedication("Puravit"), colidis]);

        Assert.Equal((colidis.Id, 0), (match!.Medication.Id, match.Distance));
    }

    [Fact]
    public void FindBestMatch_Typo_MatchesWithinTolerance()
    {
        var flygas = ImportTestData.CatalogMedication("Flygas");

        var match = MedicationNameMatcher.FindBestMatch("Flagas", [flygas]);

        Assert.Equal((flygas.Id, 1), (match!.Medication.Id, match.Distance));
    }

    [Fact]
    public void FindBestMatch_SeveralCandidates_PrefersTheClosest()
    {
        var colicaliv = ImportTestData.CatalogMedication("Colicaliv");

        var match = MedicationNameMatcher.FindBestMatch("Colicalive", [ImportTestData.CatalogMedication("Colicalix"), colicaliv]);

        Assert.Equal(colicaliv.Id, match!.Medication.Id);
    }

    [Theory]
    [InlineData("Flagas", "Flagyl")]
    [InlineData("Vit", "Vix")]
    [InlineData("Puravit", "Colidis")]
    public void FindBestMatch_TooDifferent_ReturnsNull(string name, string catalogName)
    {
        Assert.Null(MedicationNameMatcher.FindBestMatch(name, [ImportTestData.CatalogMedication(catalogName)]));
    }

    [Theory]
    [InlineData("Flagas", "Flygas", true)]
    [InlineData("Simeticona", "Simeticone", true)]
    [InlineData("Flagas", "Flagyl", false)]
    public void AreSimilar_UsesLengthBasedTolerance(string left, string right, bool expected)
    {
        Assert.Equal(expected, MedicationNameMatcher.AreSimilar(left, right));
    }

    private static string RandomName(Random random) =>
        new(Enumerable.Range(0, random.Next(0, 12)).Select(_ => "abcde"[random.Next(5)]).ToArray());
}
