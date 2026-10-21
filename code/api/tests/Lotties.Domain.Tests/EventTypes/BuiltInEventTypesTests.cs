using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Tests.EventTypes;

public sealed class BuiltInEventTypesTests
{
    [Fact]
    public void All_ContainsSpecTemplates()
    {
        var keys = BuiltInEventTypes.All.Select(type => type.Key.Value).ToArray();

        Assert.Equal(["feeding", "sleep", "diaper", "bath", "tummy_time", "medication", "belly_pain", "breast_pump"], keys);
    }

    [Fact]
    public void All_AreBuiltInWithUniqueStableIds()
    {
        Assert.All(BuiltInEventTypes.All, type => Assert.True(type.IsBuiltIn));
        Assert.Equal(BuiltInEventTypes.All.Count, BuiltInEventTypes.All.Select(type => type.Id).Distinct().Count());
        Assert.Equal(new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"), BuiltInEventTypes.Feeding.Id);
        Assert.Equal(new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"), BuiltInEventTypes.BreastPump.Id);
    }

    [Theory]
    [InlineData("feeding", true)]
    [InlineData("sleep", true)]
    [InlineData("tummy_time", true)]
    [InlineData("diaper", false)]
    [InlineData("bath", false)]
    [InlineData("medication", false)]
    [InlineData("belly_pain", false)]
    [InlineData("breast_pump", true)]
    public void All_HasDurationPerType(string key, bool hasDuration)
    {
        Assert.Equal(hasDuration, BuiltInEventTypes.All.Single(type => type.Key.Value == key).HasDuration);
    }

    [Fact]
    public void Feeding_HasRequiredMethodAndOptionalDetailFields()
    {
        var fields = BuiltInEventTypes.Feeding.Fields;

        Assert.Equal(["method", "side", "amount_ml", "bottle_feeding_type", "breast_left_seconds", "breast_right_seconds", "food", "pause_count", "paused_seconds", "paused_at"], fields.Select(field => field.Key));
        Assert.Equal(["breast", "bottle", "solid"], fields[0].Options);
        Assert.Equal(["formula", "breast_milk"], fields[3].Options);
        Assert.Equal([true, false, false, false, false, false, false, false, false, false], fields.Select(field => field.IsRequired));
        Assert.Equal((EventFieldKind.Number, EventFieldKind.Text), (fields[2].Kind, fields[6].Kind));
    }

    [Theory]
    [InlineData("method", null)]
    [InlineData("side", "breast")]
    [InlineData("breast_left_seconds", "breast")]
    [InlineData("breast_right_seconds", "breast")]
    [InlineData("amount_ml", "bottle")]
    [InlineData("bottle_feeding_type", "bottle")]
    [InlineData("food", "solid")]
    public void Feeding_DetailFieldsAreVisibleOnlyForTheirMethod(string key, string? method)
    {
        var visibleWhen = BuiltInEventTypes.Feeding.Fields.Single(field => field.Key == key).VisibleWhen;

        (string Field, string Value)? expected = method is null ? null : ("method", method);
        (string Field, string Value)? actual = visibleWhen is null ? null : (visibleWhen.Field, Assert.Single(visibleWhen.Values));

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void BreastPump_HasOptionalNonNegativeLeftAndRightAmounts()
    {
        var fields = BuiltInEventTypes.BreastPump.Fields.Take(2).ToArray();

        Assert.Equal(["amount_left_ml", "amount_right_ml"], fields.Select(field => field.Key));
        Assert.All(fields, field => Assert.Equal((EventFieldKind.Number, false, 0m, (decimal?)null, "ml", (FieldVisibilityCondition?)null), (field.Kind, field.IsRequired, field.Min, field.Max, field.Unit, field.VisibleWhen)));
        Assert.Equal(("Breast pump", "opacity"), (BuiltInEventTypes.BreastPump.Name, BuiltInEventTypes.BreastPump.Icon));
    }

    [Fact]
    public void Diaper_HasRequiredContentSelect()
    {
        var content = Assert.Single(BuiltInEventTypes.Diaper.Fields);

        Assert.Equal(("content", EventFieldKind.Select, true), (content.Key, content.Kind, content.IsRequired));
        Assert.Equal(["WET", "DIRTY", "MIXED"], content.Options);
    }

    [Fact]
    public void Sleep_HasOptionalKindDeprecatedMoodDetailsAndPauses()
    {
        var fields = BuiltInEventTypes.Sleep.Fields;

        Assert.Equal(
            ["kind", "mood", "how_slept", "fall_asleep", "time_to_fall_asleep_minutes", "how_woke", "mood_on_wake", "pause_count", "paused_seconds", "paused_at"],
            fields.Select(field => field.Key));
        Assert.Equal(["nap", "night", "night_waking", "bed_time", "woke_up", "fell_asleep"], fields[0].Options);
        Assert.All(fields, field => Assert.False(field.IsRequired));
        Assert.Equal((EventFieldKind.Text, true, (FieldVisibilityCondition?)null), (fields[1].Kind, fields[1].IsHidden, fields[1].VisibleWhen));
    }

    [Theory]
    [InlineData("how_slept", "in_bed,nursing,held,next_to_me,bottle,stroller,car,swing,other")]
    [InlineData("fall_asleep", "easy,took_long,fussy")]
    [InlineData("how_woke", "naturally,woken")]
    [InlineData("mood_on_wake", "good,neutral,bad")]
    public void Sleep_DetailSelects_HaveTheirOptionsAndShowOnlyForNapAndNight(string key, string options)
    {
        var field = BuiltInEventTypes.Sleep.Fields.Single(field => field.Key == key);

        Assert.Equal((EventFieldKind.Select, false), (field.Kind, field.IsHidden));
        Assert.Equal(options.Split(','), field.Options);
        Assert.Equal("kind", field.VisibleWhen!.Field);
        Assert.Equal(["nap", "night"], field.VisibleWhen.Values);
    }

    [Fact]
    public void Sleep_TimeToFallAsleep_IsAWholeNumberOfMinutesUpToFourHoursForNapAndNight()
    {
        var field = BuiltInEventTypes.Sleep.Fields.Single(field => field.Key == "time_to_fall_asleep_minutes");

        Assert.Equal((EventFieldKind.Number, 0m, 240m, "min", true, false), (field.Kind, field.Min!.Value, field.Max!.Value, field.Unit, field.IsInteger, field.IsHidden));
        Assert.Equal(["nap", "night"], field.VisibleWhen!.Values);
    }

    [Theory]
    [InlineData("sleep")]
    [InlineData("feeding")]
    [InlineData("tummy_time")]
    [InlineData("bath")]
    [InlineData("breast_pump")]
    public void TimedTypes_DeclareHiddenPauseFieldsLast(string key)
    {
        var fields = BuiltInEventTypes.All.Single(type => type.Key.Value == key).Fields.TakeLast(3).ToArray();

        Assert.Equal(
            [("pause_count", EventFieldKind.Number, 0m, (decimal?)100m, true), ("paused_seconds", EventFieldKind.Number, 0m, 86400m, true), ("paused_at", EventFieldKind.Text, (decimal?)null, (decimal?)null, false)],
            fields.Select(field => (field.Key, field.Kind, field.Min, field.Max, field.IsInteger)));
        Assert.All(fields, field => Assert.Equal((true, false, (FieldVisibilityCondition?)null), (field.IsHidden, field.IsRequired, field.VisibleWhen)));
    }

    [Theory]
    [InlineData("diaper")]
    [InlineData("medication")]
    [InlineData("belly_pain")]
    public void InstantTypes_DeclareNoPauseFields(string key)
    {
        Assert.DoesNotContain(BuiltInEventTypes.All.Single(type => type.Key.Value == key).Fields, field => field.Key.StartsWith("pause", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("bath", "temperature_c")]
    [InlineData("tummy_time", "mood")]
    public void BathAndTummyTime_HaveOneOptionalVisibleFieldBesidesPauses(string key, string fieldKey)
    {
        var field = Assert.Single(BuiltInEventTypes.All.Single(type => type.Key.Value == key).Fields, field => !field.IsHidden);

        Assert.Equal((fieldKey, false), (field.Key, field.IsRequired));
    }

    [Fact]
    public void BellyPain_HasRequiredIntensityFromOneToFive()
    {
        var intensity = Assert.Single(BuiltInEventTypes.BellyPain.Fields);

        Assert.Equal(("intensity", EventFieldKind.Number, true, 1m, 5m), (intensity.Key, intensity.Kind, intensity.IsRequired, intensity.Min, intensity.Max));
    }
}
