using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Imports;
using static BabyRoutine.Domain.Tests.Imports.ImportTestData;

namespace BabyRoutine.Domain.Tests.Imports;

public sealed class NapperEventMapperTests
{
    private static NapperEventDraft Mapped(NapperLogRow row) => NapperEventMapper.Map(row).Draft ?? throw new Xunit.Sdk.XunitException("Row was skipped.");

    private static ImportSkippedRow Skipped(NapperLogRow row) => NapperEventMapper.Map(row).Skip ?? throw new Xunit.Sdk.XunitException("Row was mapped.");

    [Fact]
    public void Map_Bottle_IsFeedingByBottleWithAmountAndContent()
    {
        var draft = Mapped(Row("BOTTLE", Offset, Offset.AddMinutes(15)) with { FeedingAmount = 120m, BottleFeedingType = "formula", Comment = "Took it slowly, then burped" });

        Assert.Equal(BuiltInEventTypes.FeedingId, draft.Type.Id);
        Assert.Equal(("bottle", "120", "FORMULA"), (Text(draft.Payload, "method"), Text(draft.Payload, "amount_ml"), Text(draft.Payload, "bottle_feeding_type")));
        Assert.Equal((Offset, Offset.AddMinutes(15)), (draft.StartedAt, draft.EndedAt));
        Assert.Equal("Took it slowly, then burped", draft.Notes);
    }

    [Fact]
    public void Map_BottleWithUnknownContent_KeepsItInNotes()
    {
        var draft = Mapped(Row("BOTTLE") with { BottleFeedingType = "JUICE" });

        Assert.Null(Text(draft.Payload, "bottle_feeding_type"));
        Assert.Equal("Bottle content: JUICE", draft.Notes);
    }

    [Fact]
    public void Map_BottleWithoutEnd_IsAnInstant()
    {
        var draft = Mapped(Row("BOTTLE") with { End = null });

        Assert.Equal(draft.StartedAt, draft.EndedAt);
    }

    [Theory]
    [InlineData(600, 540, "both")]
    [InlineData(600, 0, "left")]
    [InlineData(null, 300, "right")]
    public void Map_Nursing_IsBreastFeedingWithSecondsAndDerivedSide(int? left, int? right, string side)
    {
        var draft = Mapped(Row("NURSING", Offset, Offset.AddMinutes(20)) with { BreastLeftSeconds = left, BreastRightSeconds = right });

        Assert.Equal(("breast", side), (Text(draft.Payload, "method"), Text(draft.Payload, "side")));
        Assert.Equal(left?.ToString(), Text(draft.Payload, "breast_left_seconds"));
        Assert.Equal(Offset.AddMinutes(20), draft.EndedAt);
    }

    [Fact]
    public void Map_NursingStoredAsInstant_EndsAfterTheNursedSeconds()
    {
        var draft = Mapped(Row("NURSING") with { BreastLeftSeconds = 600, BreastRightSeconds = 540, NumberOfPauses = 2 });

        Assert.Equal(Offset.AddSeconds(1140), draft.EndedAt);
        Assert.Equal("Pauses: 2", draft.Notes);
    }

    [Fact]
    public void Map_NursingWithoutSeconds_HasNoSide()
    {
        var draft = Mapped(Row("NURSING", Offset, Offset.AddMinutes(5)));

        Assert.Null(Text(draft.Payload, "side"));
    }

    [Theory]
    [InlineData("WET")]
    [InlineData("dirty")]
    [InlineData(" Mixed ")]
    public void Map_ChangedDiaper_IsDiaperInstantWithUpperCaseContent(string content)
    {
        var draft = Mapped(Row("CHANGED_DIAPER", Offset, Offset.AddMinutes(3)) with { DiaperContent = content });

        Assert.Equal(BuiltInEventTypes.DiaperId, draft.Type.Id);
        Assert.Equal(content.Trim().ToUpperInvariant(), Text(draft.Payload, "content"));
        Assert.Equal(draft.StartedAt, draft.EndedAt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("SOLID")]
    public void Map_ChangedDiaperWithoutValidContent_IsSkippedAsMissingValue(string? content)
    {
        var skipped = Skipped(Row("CHANGED_DIAPER", rowNumber: 7) with { DiaperContent = content });

        Assert.Equal((7, "CHANGED_DIAPER", ImportSkipCodes.MissingValue), (skipped.Row, skipped.Category, skipped.Code));
    }

    [Theory]
    [InlineData("NAP", "nap")]
    [InlineData("NIGHT_WAKING", "night_waking")]
    public void Map_SleepDurations_KeepStartAndEndWithKind(string category, string kind)
    {
        var draft = Mapped(Row(category, Offset, Offset.AddMinutes(90)));

        Assert.Equal(BuiltInEventTypes.SleepId, draft.Type.Id);
        Assert.Equal(kind, Text(draft.Payload, "kind"));
        Assert.Equal(Offset.AddMinutes(90), draft.EndedAt);
    }

    [Theory]
    [InlineData("BED_TIME", "bed_time")]
    [InlineData("WOKE_UP", "woke_up")]
    public void Map_BedTimeAndWokeUp_AreSleepInstants(string category, string kind)
    {
        var draft = Mapped(Row(category, Offset, Offset.AddMinutes(1)));

        Assert.Equal(kind, Text(draft.Payload, "kind"));
        Assert.Equal(draft.StartedAt, draft.EndedAt);
    }

    [Fact]
    public void Map_NapWithMoods_PutsWakeUpMoodInPayloadAndTheRestInNotes()
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddHours(1)) with
        {
            BabyMoodOnWakeUp = "HAPPY",
            BabyMoodOnSleep = "CALM",
            HowBabySlept = "GOOD",
            HowBabyWoke = "SMILING",
            Comment = "In the stroller",
        });

        Assert.Equal("HAPPY", Text(draft.Payload, "mood"));
        Assert.Equal("In the stroller\nMood on sleep: CALM\nHow baby slept: GOOD\nHow baby woke: SMILING", draft.Notes);
    }

    [Fact]
    public void Map_NapWithoutWakeUpMood_UsesHowBabySleptAsMood()
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddHours(1)) with { HowBabySlept = "GOOD" });

        Assert.Equal("GOOD", Text(draft.Payload, "mood"));
        Assert.Null(draft.Notes);
    }

    [Fact]
    public void Map_NapWithoutEnd_IsSkippedAsStillRunning()
    {
        var skipped = Skipped(Row("NAP") with { End = null });

        Assert.Equal(ImportSkipCodes.MissingValue, skipped.Code);
    }

    [Fact]
    public void Map_Medicine_IsMedicationInstantWithTokensAndNoNotes()
    {
        var draft = Mapped(Row("MEDICINE") with { Comment = "Colidis e Puravit" });

        Assert.Equal(BuiltInEventTypes.MedicationId, draft.Type.Id);
        Assert.Equal(["Colidis", "Puravit"], draft.MedicationTokens);
        Assert.Null(draft.Notes);
    }

    [Fact]
    public void Map_MedicineWithoutComment_IsSkipped()
    {
        Assert.Equal(ImportSkipCodes.MissingValue, Skipped(Row("MEDICINE")).Code);
    }

    [Fact]
    public void Map_UnknownCategory_IsSkippedWithReason()
    {
        var skipped = Skipped(Row("PUMPING", rowNumber: 3));

        Assert.Equal((3, ImportSkipCodes.UnknownCategory), (skipped.Row, skipped.Code));
        Assert.Contains("PUMPING", skipped.Reason, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("BOTTLE", "feeding")]
    [InlineData("NURSING", "feeding")]
    [InlineData("CHANGED_DIAPER", "diaper")]
    [InlineData("NAP", "sleep")]
    [InlineData("NIGHT_WAKING", "sleep")]
    [InlineData("BED_TIME", "sleep")]
    [InlineData("WOKE_UP", "sleep")]
    [InlineData("MEDICINE", "medication")]
    public void TypeFor_KnownCategory_ReturnsBuiltInType(string category, string key)
    {
        Assert.Equal(key, NapperEventMapper.TypeFor(category)?.Key.Value);
    }

    [Fact]
    public void TypeFor_UnknownCategory_ReturnsNull()
    {
        Assert.Null(NapperEventMapper.TypeFor("PUMPING"));
    }
}
