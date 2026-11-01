using System.Text;
using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.Catalog.Official;
using Lotties.Infrastructure.Persistence.Seed;

namespace Lotties.Infrastructure.Tests.Catalog;

/// <summary>Reading the ANVISA files: synthetic rows only (the real files are downloaded by the importer, never committed).</summary>
public sealed class DelimitedTextTests
{
    [Fact]
    public void Parse_QuotedFieldsWithDelimitersQuotesAndNewlines()
    {
        var records = DelimitedText.Parse("\"A;1\";\"say \"\"hi\"\"\";\"two\nlines\"\r\nplain;;last\n", ';').ToArray();

        Assert.Equal(2, records.Length);
        Assert.Equal(["A;1", "say \"hi\"", "two\nlines"], records[0]);
        Assert.Equal(["plain", string.Empty, "last"], records[1]);
    }

    [Fact]
    public void Parse_SkipsBlankLinesAndKeepsAMissingFinalNewlineRecord()
    {
        var records = DelimitedText.Parse("a;b\n\n   \r\nc;d", ';').ToArray();

        Assert.Equal(new[] { new[] { "a", "b" }, new[] { "c", "d" } }, records.Select(record => record.ToArray()));
    }

    [Theory]
    [InlineData("A;B;C", ';')]
    [InlineData("A,B,C", ',')]
    [InlineData("A\tB\tC", '\t')]
    [InlineData("A", ';')]
    public void DetectDelimiter_PicksTheMostFrequent(string header, char expected)
    {
        Assert.Equal(expected, DelimitedText.DetectDelimiter(header));
    }
}

public sealed class SourceTextTests
{
    [Fact]
    public void Decode_Windows1252_KeepsAccentsAndCurlyQuotes()
    {
        var bytes = Encoding.Latin1.GetBytes("SÓDIO;").Concat(new byte[] { 0x93, 0x41, 0x94 }).ToArray();

        var decoded = SourceText.Decode(bytes);

        Assert.Equal(("SÓDIO;“A”", "windows-1252"), (decoded.Text, decoded.EncodingName));
    }

    [Fact]
    public void Decode_Utf8WithBom_DropsTheBom()
    {
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("SUBSTÂNCIA;REGISTRO")).ToArray();

        var decoded = SourceText.Decode(bytes);

        Assert.Equal(("SUBSTÂNCIA;REGISTRO", "utf-8"), (decoded.Text, decoded.EncodingName));
    }

    [Fact]
    public void Decode_Utf8WithoutBom_IsReadAsUtf8()
    {
        var decoded = SourceText.Decode(Encoding.UTF8.GetBytes("Cloreto de sódio"));

        Assert.Equal(("Cloreto de sódio", "utf-8"), (decoded.Text, decoded.EncodingName));
    }
}

public sealed class AnvisaFilesTests
{
    private const string RegistrationsHeader = "TIPO_PRODUTO;NOME_PRODUTO;DATA_FINALIZACAO_PROCESSO;CATEGORIA_REGULATORIA;NUMERO_REGISTRO_PRODUTO;DATA_VENCIMENTO_REGISTRO;NUMERO_PROCESSO;CLASSE_TERAPEUTICA;EMPRESA_DETENTORA_REGISTRO;SITUACAO_REGISTRO;PRINCIPIO_ATIVO";

    private static readonly string Registrations = string.Join("\r\n",
        RegistrationsHeader,
        "\"MEDICAMENTO\";\"NOVALGINA\";\"13/11/2023\";\"Novo\";186200018;\"042028\";\"1\";\"ANALGESICOS\";\"00000000000000 - EMPRESA FICTICIA\";\"Ativo\";\"dipirona monoidratada\"",
        string.Empty,
        "\"MEDICAMENTO\";\"SORO NASAL\";\"18/08/2008\";\"BAIXO RISCO\";;;;;\"00000000000000 - EMPRESA FICTICIA\";\"Ativo\";",
        "\"MEDICAMENTO\";\"CURTO\"",
        "\"MEDICAMENTO\";\"X; Y\";\"01/01/2020\";\"Similar\";100000001;\"012030\";\"2\";\"C\";\"E\";\"Inativo\";\"a, b\"");

    [Fact]
    public void ReadRegistrations_MapsColumnsByHeaderAndCountsShortRecords()
    {
        var read = AnvisaFiles.ReadRegistrations(Registrations);

        Assert.Equal(3, read.Rows.Count);
        Assert.Equal(new AnvisaRegistrationRow("NOVALGINA", "186200018", "Ativo", "dipirona monoidratada"), read.Rows[0]);
        Assert.Equal(new AnvisaRegistrationRow("SORO NASAL", string.Empty, "Ativo", string.Empty), read.Rows[1]);
        Assert.Equal("X; Y", read.Rows[2].ProductName);
        Assert.Equal((1, ';'), (read.ShortRecords, read.Delimiter));
    }

    [Fact]
    public void ReadRegistrations_Limit_ReadsTheFirstRows()
    {
        Assert.Single(AnvisaFiles.ReadRegistrations(Registrations, limit: 1).Rows);
    }

    [Fact]
    public void ReadRegistrations_MissingColumn_ThrowsInvalidImportFile()
    {
        var exception = Assert.Throws<InvalidImportFileException>(() => AnvisaFiles.ReadRegistrations("NOME_PRODUTO;SITUACAO_REGISTRO\nA;Ativo"));

        Assert.Equal("registrations", exception.Field);
    }

    [Fact]
    public void ReadPresentations_FindsTheAccentedHeaderAfterTitleLines()
    {
        const string text = "LISTA DE PREÇOS\n\nSUBSTÂNCIA;CNPJ;LABORATÓRIO;REGISTRO;PRODUTO;APRESENTAÇÃO\n\"SIMETICONA\";1;LAB;1739000090031;LUFTAL;75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML\n";

        var read = AnvisaFiles.ReadPresentations(text);

        Assert.Equal(new CmedPresentationRow("1739000090031", "LUFTAL", "75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML"), Assert.Single(read.Rows));
    }

    [Theory]
    [InlineData("APRESENTAÇÃO", "APRESENTACAO")]
    [InlineData("﻿Substância", "SUBSTANCIA")]
    [InlineData(" Tipo de Produto ", "TIPO_DE_PRODUTO")]
    public void HeaderKey_IgnoresCaseAccentsAndSpaces(string header, string expected)
    {
        Assert.Equal(expected, AnvisaFiles.HeaderKey(header));
    }
}

public sealed class CuratedSubstancesTests
{
    private static readonly IReadOnlyList<CuratedSubstance> Map = CuratedSubstances.Load();

    [Fact]
    public void Map_BuildsADictionaryWithValidUniqueKeysAndSourceNames()
    {
        var dictionary = SubstanceDictionary.Create(Map);

        Assert.NotNull(dictionary);
        Assert.All(Map, entry => Assert.True(SubstanceKeys.IsValid(entry.Key), entry.Key));
        Assert.All(Map, entry => Assert.NotEmpty(entry.SourceNames));
        Assert.All(Map, entry => Assert.True(entry.Synonyms.Count <= Substance.MaxSynonyms, entry.Key));
        Assert.All(Map, entry => Substance.FromOfficialList(Guid.NewGuid(), entry.Key, entry.NameEn, entry.NamePtBr, entry.Synonyms, DateTimeOffset.UnixEpoch));
    }

    [Fact]
    public void Map_SeededKeysKeepTheSeedNamesAndSynonyms()
    {
        foreach (var seeded in MedicationCatalogSeed.Substances)
        {
            var entry = Assert.Single(Map, candidate => candidate.Key == seeded.Key);
            Assert.Equal((seeded.NameEn, seeded.NamePtBr), (entry.NameEn, entry.NamePtBr));
            Assert.Equal(seeded.Synonyms, entry.Synonyms);
        }
    }

    [Theory]
    [InlineData("simeticona", "simethicone")]
    [InlineData("dipirona monoidratada", "metamizole")]
    [InlineData("DIPIRONA SÓDICA", "metamizole")]
    [InlineData("paracetamol", "paracetamol")]
    [InlineData("ibuprofeno", "ibuprofen")]
    [InlineData("cloreto de sódio", "sodium_chloride")]
    [InlineData("colecalciferol", "cholecalciferol")]
    [InlineData("amoxicilina tri-hidratada", "amoxicillin")]
    [InlineData("cloridrato de nafazolina", "naphazoline")]
    public void Map_ResolvesCommonPediatricSpellings(string sourceName, string expectedKey)
    {
        var substance = CuratedSubstances.Dictionary().Resolve(sourceName);

        Assert.Equal((expectedKey, true), (substance.Key, substance.Curated));
    }

    [Fact]
    public void Map_KeepsDimethiconeApartFromSimethicone()
    {
        Assert.False(CuratedSubstances.Dictionary().Resolve("dimeticona").Curated);
    }
}
