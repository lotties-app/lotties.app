using BabyRoutine.Application.Imports;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Api.Tests.Imports;

public sealed class NapperCsvParserTests
{
    private static ParsedRows<NapperLogRow> Logs(string csv) => NapperCsvParser.ParseLogs(csv, "logsCsv", 100);

    [Fact]
    public void ParseLogs_RealHeaderOrder_ReadsTypedCellsWithOffsets()
    {
        var csv = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Imports", "Fixtures", "napper-logs.csv"));

        var parsed = Logs(csv);

        var bottle = parsed.Rows[0];
        Assert.Equal((1, "BOTTLE", 120m, "FORMULA"), (bottle.RowNumber, bottle.Category, bottle.FeedingAmount, bottle.BottleFeedingType));
        Assert.Equal(new DateTimeOffset(2025, 9, 1, 8, 0, 0, TimeSpan.FromHours(-3)), bottle.Start);
        Assert.Equal(new DateTimeOffset(2025, 9, 1, 11, 0, 0, TimeSpan.Zero), bottle.Start.ToUniversalTime());
        Assert.Equal("Took it slowly, then burped", bottle.Comment);
        Assert.Equal((600, 540, 2), (parsed.Rows[4].BreastLeftSeconds, parsed.Rows[4].BreastRightSeconds, parsed.Rows[4].NumberOfPauses));
        Assert.Contains("line two, with comma", parsed.Rows[10].Comment, StringComparison.Ordinal);
    }

    [Fact]
    public void ParseLogs_UnreadablePauseCells_KeepTheRowAndRecordTheRawText()
    {
        var parsed = Logs("start,end,category,numberOfPauses,pausedMinutes\n2025-09-01T09:00:00Z,2025-09-01T10:00:00Z,NAP,many,\"2,5\"\n");

        var row = Assert.Single(parsed.Rows);
        Assert.Empty(parsed.Unreadable);
        Assert.Equal(((int?)null, (decimal?)2.5m), (row.NumberOfPauses, row.PausedMinutes));
        Assert.Equal(new Dictionary<string, string> { ["numberOfPauses"] = "many" }, row.InvalidCells);
    }

    [Fact]
    public void ParseLogs_ReadablePauseCells_HaveNoInvalidCells()
    {
        var row = Assert.Single(Logs("start,end,category,numberOfPauses,pausedMinutes\n2025-09-01T09:00:00Z,2025-09-01T10:00:00Z,NAP,2,5.5\n").Rows);

        Assert.Equal((2, 5.5m), (row.NumberOfPauses!.Value, row.PausedMinutes!.Value));
        Assert.Empty(row.InvalidCells);
    }

    [Fact]
    public void ParseLogs_ColumnsInAnyOrderAndCase_AreFoundByName()
    {
        var parsed = Logs("Category,COMMENT,End,start\nnap,ok,2025-09-01T10:00:00Z,2025-09-01T09:00:00Z\n");

        var row = Assert.Single(parsed.Rows);
        Assert.Equal(("NAP", "ok"), (row.Category, row.Comment));
        Assert.Equal(new DateTimeOffset(2025, 9, 1, 9, 0, 0, TimeSpan.Zero), row.Start);
    }

    [Fact]
    public void ParseLogs_EmptyCells_AreNull()
    {
        var row = Assert.Single(Logs("start,end,category,feedingAmount,comment\n2025-09-01T09:00:00-03:00,,BOTTLE,,\n").Rows);

        Assert.Null(row.End);
        Assert.Null(row.FeedingAmount);
        Assert.Null(row.Comment);
    }

    [Theory]
    [InlineData("not-a-date", "invalid_value")]
    [InlineData("2025-09-01T09:00:00", "invalid_value")]
    [InlineData("01/09/2025 09:00", "invalid_value")]
    [InlineData("", "missing_value")]
    public void ParseLogs_StartWithoutOffsetOrInvalid_IsUnreadableWithReason(string start, string code)
    {
        var parsed = Logs($"start,end,category\n{start},2025-09-01T09:00:00-03:00,NAP\n");

        Assert.Empty(parsed.Rows);
        var unreadable = Assert.Single(parsed.Unreadable);
        Assert.Equal((1, code), (unreadable.Row, unreadable.Code));
    }

    [Fact]
    public void ParseLogs_InvalidNumber_IsUnreadable()
    {
        var parsed = Logs("start,end,category,feedingAmount\n2025-09-01T09:00:00Z,2025-09-01T09:00:00Z,BOTTLE,lots\n");

        Assert.Contains("feedingAmount", Assert.Single(parsed.Unreadable).Reason, StringComparison.Ordinal);
    }

    [Fact]
    public void ParseLogs_DecimalComma_IsAccepted()
    {
        var row = Assert.Single(Logs("start,end,category,feedingAmount\n2025-09-01T09:00:00Z,2025-09-01T09:00:00Z,BOTTLE,\"90,5\"\n").Rows);

        Assert.Equal(90.5m, row.FeedingAmount);
    }

    [Fact]
    public void ParseLogs_MissingCategory_IsUnreadableAsMissingValue()
    {
        var unreadable = Assert.Single(Logs("start,end,category\n2025-09-01T09:00:00Z,2025-09-01T09:00:00Z,\n").Unreadable);

        Assert.Equal(ImportSkipCodes.MissingValue, unreadable.Code);
    }

    [Fact]
    public void ParseLogs_MissingRequiredColumn_ThrowsInvalidFile()
    {
        var exception = Assert.Throws<InvalidImportFileException>(() => Logs("start,category\n2025-09-01T09:00:00Z,NAP\n"));

        Assert.Contains("end", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ParseLogs_EmptyText_ThrowsInvalidFile()
    {
        Assert.Throws<InvalidImportFileException>(() => Logs("\r\n"));
    }

    [Fact]
    public void ParseMeasurements_DatesTimestampsAndEmptyValues_AreRead()
    {
        var csv = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Imports", "Fixtures", "napper-measurements.csv"));

        var parsed = NapperCsvParser.ParseMeasurements(csv, "measurementsCsv", 100);

        Assert.Equal(new NapperMeasurementRow(1, new DateOnly(2025, 8, 31), 3.45m, 50.5m, 35m), parsed.Rows[0]);
        Assert.Equal(new NapperMeasurementRow(2, new DateOnly(2025, 9, 15), 4.1m, null, null), parsed.Rows[1]);
        Assert.Equal(new DateOnly(2025, 10, 5), parsed.Rows[^1].Date);
        Assert.Equal(5, Assert.Single(parsed.Unreadable).Row);
    }
}
