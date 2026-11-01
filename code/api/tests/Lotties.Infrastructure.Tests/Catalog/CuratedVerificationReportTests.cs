using System.Text.Json;
using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Catalog.Official.Verification;
using Lotties.Infrastructure.Catalog.Official;

namespace Lotties.Infrastructure.Tests.Catalog;

/// <summary>Reading the verifier's inputs and rendering its reports: synthetic rows only.</summary>
public sealed class CuratedVerificationReportTests
{
    private const string RegistrationsCsv =
        "\"TIPO_PRODUTO\";\"NOME_PRODUTO\";\"DATA_FINALIZACAO_PROCESSO\";\"CATEGORIA_REGULATORIA\";\"NUMERO_REGISTRO_PRODUTO\";\"DATA_VENCIMENTO_REGISTRO\";\"NUMERO_PROCESSO\";\"CLASSE_TERAPEUTICA\";\"EMPRESA_DETENTORA_REGISTRO\";\"SITUACAO_REGISTRO\";\"PRINCIPIO_ATIVO\"\n" +
        "\"MEDICAMENTO\";\"FAKEFLAT\";\"01/01/2020\";\"Novo\";100000001;\"012030\";\"1\";\"X\";\"60659463000191 - ACME FARMA LTDA\";\"Ativo\";\"simeticona\"\n" +
        "\"MEDICAMENTO\";\"SORINE\";\"01/01/2020\";\"BAIXO RISCO\";;;;;\"60659463000191 - ACME FARMA LTDA\";\"Ativo\";\n";

    private const string PresentationsCsv =
        "SUBSTÂNCIA;REGISTRO;PRODUTO;APRESENTAÇÃO\n" +
        "\"SIMETICONA\";1000000010011;FAKEFLAT;75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML\n";

    private static CuratedProductEntry Entry(string id, string name, string[] ingredients, string? route = "oral") =>
        new(id, name, ProductForm.Drops, ingredients, false, "synthetic", Route: route);

    private static CuratedVerificationReport Report(params CuratedProductEntry[] entries)
    {
        var registrations = AnvisaFiles.ReadRegistrationDetails(RegistrationsCsv).Rows;
        var presentations = AnvisaFiles.ReadPresentationDetails(PresentationsCsv).Rows;
        var dictionary = CuratedSubstances.Dictionary();
        var plan = OfficialCatalogPlanner.Plan(registrations.Select(row => row.ToRow()).ToArray(), presentations.Select(row => row.ToRow()).ToArray(), dictionary);
        return CuratedVerificationRunner.Run(entries, new CuratedVerifier(registrations, presentations, dictionary), dictionary, plan, new DateOnly(2026, 10, 23));
    }

    [Fact]
    public void ReadRegistrationDetails_ReadsHolderAndCategoryByHeaderName()
    {
        var rows = AnvisaFiles.ReadRegistrationDetails(RegistrationsCsv).Rows;

        Assert.Equal(2, rows.Count);
        Assert.Equal(("FAKEFLAT", "100000001", true, "simeticona", "Novo"), (rows[0].ProductName, rows[0].RegistrationNumber, rows[0].IsActive, rows[0].ActiveIngredients, rows[0].Category));
        Assert.Equal("60659463000191 - ACME FARMA LTDA", rows[0].Holder);
        Assert.Equal("BAIXO RISCO", rows[1].Category);
    }

    [Fact]
    public void ReadPresentationDetails_ReadsTheSubstanceColumnDespiteAccentsInTheHeader()
    {
        var rows = AnvisaFiles.ReadPresentationDetails(PresentationsCsv).Rows;

        var row = Assert.Single(rows);
        Assert.Equal(("SIMETICONA", "1000000010011"), (row.Substance, row.Registration));
        Assert.Contains("GOT", row.Presentation, StringComparison.Ordinal);
    }

    [Fact]
    public void Report_RendersEveryStatusInMarkdownAndJsonWithoutBulkData()
    {
        var entries = new[]
        {
            Entry("fakeflat-drops", "Fakeflat", ["simeticona"]),
            Entry("zzprobio-drops", "Zzprobio", ["limosilactobacillus reuteri"]),
            Entry("sorine-drops", "Sorine", ["simeticona"]),
        };
        var report = Report(entries);

        var markdown = CuratedVerificationReports.ToMarkdown(report, entries);
        var json = JsonDocument.Parse(CuratedVerificationReports.ToJson(report)).RootElement;

        Assert.Contains("| `fakeflat-drops` Fakeflat | drops | VERIFIED | 100000001 |", markdown, StringComparison.Ordinal);
        Assert.Contains("NOT_FOUND", markdown, StringComparison.Ordinal);
        Assert.Contains("not a pharmacist's review", markdown, StringComparison.Ordinal);
        Assert.Equal(3, json.GetProperty("entries").GetArrayLength());
        Assert.Equal("verified", json.GetProperty("entries")[0].GetProperty("status").GetString());
        Assert.Equal("2026-10-23", json.GetProperty("generatedOn").GetString());
    }

    [Fact]
    public void ConsoleSummary_ListsStatusesFindingsAndTheSuggestionCounts()
    {
        var report = Report(Entry("sorine-drops", "Sorine", ["simeticona"]));

        var lines = CuratedVerificationReports.ConsoleSummary(report);

        Assert.Contains(lines, line => line.Contains("sorine-drops", StringComparison.Ordinal) && line.Contains("UNVERIFIABLE", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("Suggestions checked", StringComparison.Ordinal));
    }

    [Fact]
    public void FixProposals_AreTextOnlyAndNeverClaimAReview()
    {
        var report = Report(Entry("fakeflat-drops", "Fakeflat", ["dipirona"]));

        var proposals = CuratedVerificationReports.FixProposals(report);

        Assert.Contains(proposals, line => line.Contains("fakeflat-drops: ingredients -> official \"simeticona\"", StringComparison.Ordinal));
        Assert.Contains(proposals, line => line.Contains("\"anvisaCheck\"", StringComparison.Ordinal) && line.Contains("\"MISMATCH\"", StringComparison.Ordinal));
        Assert.Contains("NOT applied", proposals[0], StringComparison.Ordinal);
        Assert.DoesNotContain(proposals, line => line.Contains("reviewed\": true", StringComparison.Ordinal));
    }
}
