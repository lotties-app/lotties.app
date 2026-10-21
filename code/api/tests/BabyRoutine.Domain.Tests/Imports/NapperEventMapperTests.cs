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
        Assert.Equal(("bottle", "120", "formula"), (Text(draft.Payload, "method"), Text(draft.Payload, "amount_ml"), Text(draft.Payload, "bottle_feeding_type")));
        Assert.Equal((Offset, Offset.AddMinutes(15)), (draft.StartedAt, draft.EndedAt));
        Assert.Equal("Took it slowly, then burped", draft.Notes);
    }

    [Theory]
    [InlineData("FORMULA", "formula")]
    [InlineData("BREAST_MILK", "breast_milk")]
    [InlineData(" breast_milk ", "breast_milk")]
    public void Map_BottleContent_IsTheLowerCaseOptionValue(string napperContent, string option)
    {
        var draft = Mapped(Row("BOTTLE") with { BottleFeedingType = napperContent });

        Assert.Equal(option, Text(draft.Payload, "bottle_feeding_type"));
        Assert.Contains(option, BuiltInEventTypes.Feeding.Fields.Single(field => field.Key == "bottle_feeding_type").Options);
    }

    [Theory]
    [InlineData("PUMPING")]
    [InlineData("BREAST_PUMP")]
    public void Map_Pumping_IsBreastPumpWithLeftAndRightAmounts(string category)
    {
        var draft = Mapped(Row(category, Offset, Offset.AddMinutes(10)) with { AmountPumpedLeft = 40m, AmountPumpedRight = 35.5m, Comment = "Morning" });

        Assert.Equal(BuiltInEventTypes.BreastPumpId, draft.Type.Id);
        Assert.Equal(("40", "35.5"), (Text(draft.Payload, "amount_left_ml"), Text(draft.Payload, "amount_right_ml")));
        Assert.Equal((Offset, Offset.AddMinutes(10), "Morning"), (draft.StartedAt, draft.EndedAt, draft.Notes));
    }

    [Fact]
    public void Map_PumpingWithOneSideAndNoEnd_LeavesTheOtherSideOutAndEndsAtStart()
    {
        var draft = Mapped(Row("PUMPING") with { End = null, AmountPumpedLeft = 20m });

        Assert.Equal(("20", null), (Text(draft.Payload, "amount_left_ml"), Text(draft.Payload, "amount_right_ml")));
        Assert.Equal(draft.StartedAt, draft.EndedAt);
    }

    [Fact]
    public void Map_BottleWithUnknownContent_KeepsItInNotes()
    {
        var draft = Mapped(Row("BOTTLE") with { BottleFeedingType = "JUICE" });

        Assert.Null(Text(draft.Payload, "bottle_feeding_type"));
        Assert.Equal("Bottle content: JUICE", draft.Notes);
    }

    [Fact]
    public void Map_UnknownValueWithNul_IsKeptForTheNotesWhichThePlanRejects()
    {
        var row = Row("NAP", Offset, Offset.AddHours(1)) with { BabyMoodOnWakeUp = "HAP\0PY" };

        var plan = NapperEventPlanner.Plan(Context(), [row], []);

        Assert.Contains("HAP\0PY", Mapped(row).Notes, StringComparison.Ordinal);
        Assert.Equal(ImportSkipCodes.InvalidRecord, Assert.Single(plan.Skipped).Code);
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
        Assert.Equal("2", Text(draft.Payload, "pause_count"));
        Assert.Null(draft.Notes);
    }

    [Theory]
    [InlineData("NURSING")]
    [InlineData("NAP")]
    [InlineData("NIGHT_WAKING")]
    public void Map_PausesOfTimedRows_GoToPauseCountAndPausedSecondsInsteadOfNotes(string category)
    {
        var draft = Mapped(Row(category, Offset, Offset.AddMinutes(40)) with { NumberOfPauses = 3, PausedMinutes = 5.5m });

        Assert.Equal(("3", "330"), (Text(draft.Payload, "pause_count"), Text(draft.Payload, "paused_seconds")));
        Assert.Null(draft.Notes);
        Assert.Empty(draft.SkippedFields);
    }

    [Fact]
    public void Map_ZeroPauses_AddNothing()
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddMinutes(40)) with { NumberOfPauses = 0, PausedMinutes = 0m });

        Assert.Equal((null, null), (Text(draft.Payload, "pause_count"), Text(draft.Payload, "paused_seconds")));
    }

    [Theory]
    [InlineData(101, null, "numberOfPauses")]
    [InlineData(-1, null, "numberOfPauses")]
    [InlineData(null, 41, "pausedMinutes")]
    [InlineData(null, -2, "pausedMinutes")]
    public void Map_PausesOutOfRangeOrLongerThanTheEvent_AreSkippedFieldsKeptInNotes(int? count, int? minutes, string column)
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddMinutes(40), rowNumber: 4) with { NumberOfPauses = count, PausedMinutes = minutes });

        var skipped = Assert.Single(draft.SkippedFields);
        Assert.Equal((4, "NAP", column, ImportSkipCodes.InvalidValue), (skipped.Row, skipped.Category, skipped.Field, skipped.Code));
        Assert.Equal((null, null), (Text(draft.Payload, "pause_count"), Text(draft.Payload, "paused_seconds")));
        Assert.NotNull(draft.Notes);
    }

    [Fact]
    public void Map_UnreadablePauseCell_IsASkippedFieldNotASkippedRow()
    {
        var row = Row("NURSING", Offset, Offset.AddMinutes(20)) with
        {
            InvalidCells = new Dictionary<string, string> { ["numberOfPauses"] = "many" },
            PausedMinutes = 2m,
        };

        var draft = Mapped(row);

        Assert.Equal(("numberOfPauses", "many"), (Assert.Single(draft.SkippedFields).Field, draft.SkippedFields[0].Value));
        Assert.Equal((null, "120"), (Text(draft.Payload, "pause_count"), Text(draft.Payload, "paused_seconds")));
        Assert.Equal("Pauses: many", draft.Notes);
    }

    [Fact]
    public void Map_BedTimeWithPauseColumns_IgnoresThemBecauseItIsAnInstant()
    {
        var draft = Mapped(Row("BED_TIME") with { NumberOfPauses = 2, PausedMinutes = 3m });

        Assert.Equal((null, null), (Text(draft.Payload, "pause_count"), Text(draft.Payload, "paused_seconds")));
        Assert.Empty(draft.SkippedFields);
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

    [Fact]
    public void Map_NapperSleepCategories_NeverProduceTheFellAsleepKind()
    {
        var kinds = new[] { "NAP", "NIGHT_WAKING", "BED_TIME", "WOKE_UP" }
            .Select(category => Text(Mapped(Row(category, Offset, Offset.AddMinutes(90))).Payload, "kind"));

        Assert.DoesNotContain("fell_asleep", kinds);
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
    public void Map_NapWithKnownDetails_FillsTheSleepDetailFieldsAndOnlyMoodOnSleepGoesToNotes()
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddHours(1)) with
        {
            BabyMoodOnWakeUp = "GOOD",
            BabyMoodOnSleep = "NEUTRAL",
            HowBabySlept = "WORN_OR_HELD",
            HowBabyWoke = "WOKE_UP_NATURALLY",
            TimeToFallAsleep = "15",
            Comment = "In the stroller",
        });

        Assert.Equal(
            ("held", "naturally", "good", "15", null),
            (Text(draft.Payload, "how_slept"), Text(draft.Payload, "how_woke"), Text(draft.Payload, "mood_on_wake"), Text(draft.Payload, "time_to_fall_asleep_minutes"), Text(draft.Payload, "mood")));
        Assert.Equal("In the stroller\nMood on sleep: NEUTRAL", draft.Notes);
        Assert.Empty(draft.SkippedFields);
        BuiltInEventTypes.Sleep.EnsureValidPayload(draft.Payload, draft.StartedAt, draft.EndedAt);
    }

    [Theory]
    [InlineData("IN_BED", "in_bed")]
    [InlineData("WORN_OR_HELD", "held")]
    [InlineData("BOTTLE", "bottle")]
    [InlineData("NURSING", "nursing")]
    [InlineData("STROLLER", "stroller")]
    [InlineData("CAR", "car")]
    [InlineData("SWING", "swing")]
    [InlineData("NEXT_TO_ME", "next_to_me")]
    [InlineData("CO_SLEEPING", "next_to_me")]
    [InlineData(" in bed ", "in_bed")]
    [InlineData("co-sleeping", "next_to_me")]
    public void Map_HowBabySlept_IsTheMatchingOption(string napper, string option)
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddHours(1)) with { HowBabySlept = napper });

        Assert.Equal(option, Text(draft.Payload, "how_slept"));
        Assert.Null(draft.Notes);
    }

    [Fact]
    public void Map_UnknownHowBabySlept_IsOtherWithTheRawValueInNotes()
    {
        var draft = Mapped(Row("NAP", Offset, Offset.AddHours(1)) with { HowBabySlept = "HAMMOCK" });

        Assert.Equal("other", Text(draft.Payload, "how_slept"));
        Assert.Equal("How baby slept: HAMMOCK", draft.Notes);
        Assert.Empty(draft.SkippedFields);
    }

    [Theory]
    [InlineData("WOKE_UP_NATURALLY", "naturally")]
    [InlineData("naturally", "naturally")]
    [InlineData("WOKEN_UP", "woken")]
    [InlineData("WOKE_UP_BY_PARENT", "woken")]
    [InlineData("CHILD_WOKEN", "woken")]
    public void Map_HowBabyWoke_IsNaturallyOrWoken(string napper, string option)
    {
        Assert.Equal(option, Text(Mapped(Row("NAP", Offset, Offset.AddHours(1)) with { HowBabyWoke = napper }).Payload, "how_woke"));
    }

    [Theory]
    [InlineData("GOOD", "good")]
    [InlineData("neutral", "neutral")]
    [InlineData("BAD", "bad")]
    public void Map_MoodOnWakeUp_IsTheMoodOption(string napper, string option)
    {
        Assert.Equal(option, Text(Mapped(Row("NAP", Offset, Offset.AddHours(1)) with { BabyMoodOnWakeUp = napper }).Payload, "mood_on_wake"));
    }

    [Theory]
    [InlineData("10", "10")]
    [InlineData("12.5", "13")]
    [InlineData("240", "240")]
    [InlineData("0", "0")]
    [InlineData("600", "10")]
    [InlineData("930", "16")]
    [InlineData("14400", "240")]
    public void Map_TimeToFallAsleep_IsMinutesUpTo240ElseSecondsRounded(string napper, string minutes)
    {
        Assert.Equal(minutes, Text(Mapped(Row("NAP", Offset, Offset.AddHours(1)) with { TimeToFallAsleep = napper }).Payload, "time_to_fall_asleep_minutes"));
    }

    [Theory]
    [InlineData("babyMoodOnWakeUp", "HAPPY", "Mood on wake-up: HAPPY")]
    [InlineData("howBabyWoke", "SMILING", "How baby woke: SMILING")]
    [InlineData("timeToFallAsleep", "soon", "Time to fall asleep: soon")]
    [InlineData("timeToFallAsleep", "-5", "Time to fall asleep: -5")]
    [InlineData("timeToFallAsleep", "14431", "Time to fall asleep: 14431")]
    public void Map_UnusableNapDetail_IsASkippedFieldKeptInNotesAndTheRowIsImported(string column, string value, string notes)
    {
        var row = column switch
        {
            "babyMoodOnWakeUp" => Row("NAP", Offset, Offset.AddHours(1), rowNumber: 3) with { BabyMoodOnWakeUp = value },
            "howBabyWoke" => Row("NAP", Offset, Offset.AddHours(1), rowNumber: 3) with { HowBabyWoke = value },
            _ => Row("NAP", Offset, Offset.AddHours(1), rowNumber: 3) with { TimeToFallAsleep = value },
        };

        var draft = Mapped(row);

        var skipped = Assert.Single(draft.SkippedFields);
        Assert.Equal((3, "NAP", column, value, ImportSkipCodes.InvalidValue), (skipped.Row, skipped.Category, skipped.Field, skipped.Value, skipped.Code));
        Assert.Equal(notes, draft.Notes);
        Assert.Equal("nap", Text(draft.Payload, "kind"));
    }

    [Fact]
    public void Map_NightWaking_KeepsSleepColumnsAsNotesBecauseItsKindHasNoDetailFields()
    {
        var draft = Mapped(Row("NIGHT_WAKING", Offset, Offset.AddMinutes(20)) with
        {
            BabyMoodOnWakeUp = "BAD",
            HowBabySlept = "IN_BED",
            HowBabyWoke = "CRYING",
            TimeToFallAsleep = "5",
        });

        Assert.Equal("""{"kind":"night_waking"}""", draft.Payload.Value);
        Assert.Equal("Mood on wake-up: BAD\nHow baby slept: IN_BED\nHow baby woke: CRYING\nTime to fall asleep: 5", draft.Notes);
        Assert.Empty(draft.SkippedFields);
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
        var skipped = Skipped(Row("UNKNOWN_ACTIVITY", rowNumber: 3));

        Assert.Equal((3, ImportSkipCodes.UnknownCategory), (skipped.Row, skipped.Code));
        Assert.Contains("UNKNOWN_ACTIVITY", skipped.Reason, StringComparison.Ordinal);
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
    [InlineData("PUMPING", "breast_pump")]
    [InlineData("BREAST_PUMP", "breast_pump")]
    public void TypeFor_KnownCategory_ReturnsBuiltInType(string category, string key)
    {
        Assert.Equal(key, NapperEventMapper.TypeFor(category)?.Key.Value);
    }

    [Fact]
    public void TypeFor_UnknownCategory_ReturnsNull()
    {
        Assert.Null(NapperEventMapper.TypeFor("UNKNOWN_ACTIVITY"));
    }
}
