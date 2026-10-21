using Lotties.Application.Imports.Csv;
using Lotties.Domain.Exceptions;

namespace Lotties.Api.Tests.Imports;

public sealed class CsvReaderTests
{
    private static IReadOnlyList<IReadOnlyList<string>> Read(string text, int maxDataRecords = 100) => CsvReader.ReadAll(text, "logsCsv", maxDataRecords);

    [Fact]
    public void ReadAll_PlainRecords_SplitsFieldsAndKeepsEmptyCells()
    {
        var records = Read("a,b,c\n1,,3\n");

        Assert.Equal([["a", "b", "c"], ["1", "", "3"]], records);
    }

    [Fact]
    public void ReadAll_QuotedFields_KeepCommasLineBreaksAndEscapedQuotes()
    {
        var records = Read("comment,n\r\n\"Took it slowly, then burped\",1\r\n\"Line one\r\nline \"\"two\"\"\",2\r\n");

        Assert.Equal("Took it slowly, then burped", records[1][0]);
        Assert.Equal("Line one\r\nline \"two\"", records[2][0]);
        Assert.Equal("2", records[2][1]);
    }

    [Theory]
    [InlineData("a,b\r\n1,2\r\n")]
    [InlineData("a,b\n1,2\n")]
    [InlineData("a,b\r1,2\r")]
    [InlineData("a,b\n1,2")]
    public void ReadAll_AnyLineEnding_ReadsTheSameRecords(string text)
    {
        Assert.Equal([["a", "b"], ["1", "2"]], Read(text));
    }

    [Fact]
    public void ReadAll_LeadingByteOrderMark_IsIgnored()
    {
        Assert.Equal("start", Read("﻿start,end\n")[0][0]);
    }

    [Fact]
    public void ReadAll_BlankLines_AreSkipped()
    {
        Assert.Equal(2, Read("a\n\n1\n\r\n").Count);
    }

    [Fact]
    public void ReadAll_EmptyQuotedField_IsEmptyText()
    {
        Assert.Equal(["", "x"], Read("\"\",x")[0]);
    }

    [Fact]
    public void ReadAll_UnterminatedQuote_ThrowsInvalidFile()
    {
        var exception = Assert.Throws<InvalidImportFileException>(() => Read("a\n\"never closed\n"));

        Assert.Equal("logsCsv", exception.Field);
    }

    [Fact]
    public void ReadAll_MoreDataRecordsThanAllowed_ThrowsTooManyRows()
    {
        var exception = Assert.Throws<ImportTooManyRowsException>(() => Read("h\n1\n2\n3\n", maxDataRecords: 2));

        Assert.Equal(2, exception.MaxRows);
    }

    [Fact]
    public void ReadAll_ExactlyTheAllowedDataRecords_IsAccepted()
    {
        Assert.Equal(3, Read("h\n1\n2\n", maxDataRecords: 2).Count);
    }
}
