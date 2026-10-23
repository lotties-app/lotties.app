using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Tests.EventTypes;

public sealed class BuiltInEventTypesTests
{
    /// <summary>
    /// The built-in types already deployed, in order. This list never changes: a new built-in type is appended to
    /// <see cref="BuiltInEventTypes.All"/> (after these) and needs no edit here.
    /// </summary>
    private static readonly string[] DeployedKeys = ["feeding", "sleep", "diaper", "bath", "tummy_time", "medication", "belly_pain", "breast_pump", "nasal_suction", "belly_massage", "fussy", "nail_trim", "temperature", "spit_up", "teething", "milestone", "symptom", "outdoor", "skin_care"];

    [Fact]
    public void All_StartsWithTheDeployedTypesInOrderAndHasUniqueKeys()
    {
        var keys = BuiltInEventTypes.All.Select(type => type.Key.Value).ToArray();

        Assert.Equal(DeployedKeys, keys.Take(DeployedKeys.Length));
        Assert.Equal(keys.Length, keys.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void All_AreBuiltInWithUniqueStableIds()
    {
        Assert.All(BuiltInEventTypes.All, type => Assert.True(type.IsBuiltIn));
        Assert.Equal(BuiltInEventTypes.All.Count, BuiltInEventTypes.All.Select(type => type.Id).Distinct().Count());
        Assert.Equal(new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"), BuiltInEventTypes.Feeding.Id);
        Assert.Equal(new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"), BuiltInEventTypes.BreastPump.Id);
        Assert.Equal(new Guid("4124b99c-e000-4ee0-b74a-a6579553a450"), BuiltInEventTypes.NasalSuction.Id);
        Assert.Equal(new Guid("44540b60-eb87-470f-8a3e-08170a525538"), BuiltInEventTypes.BellyMassage.Id);
        Assert.Equal(new Guid("6191006e-8767-4cd8-882f-81898fad58d3"), BuiltInEventTypes.Fussy.Id);
        Assert.Equal(
            [
                new Guid("bd1fde97-19c8-49a9-9ffd-537449183686"), new Guid("c3691235-0279-429c-be1c-db6692ad5455"),
                new Guid("1a08d284-a71f-44f5-ae83-49446a6f0e3f"), new Guid("0a3e94b0-55c5-4d85-b530-317f161ef0cc"),
                new Guid("3491e7b4-895b-406f-885a-238da041dd7c"), new Guid("fb45be64-6741-4762-ab9a-abf5c9e6a875"),
                new Guid("b22205ae-bae1-432f-802a-06e0c173efe1"), new Guid("9ad3dce5-dd4e-43d8-a022-5561ee7256ee"),
            ],
            new[]
            {
                BuiltInEventTypes.NailTrim, BuiltInEventTypes.Temperature, BuiltInEventTypes.SpitUp, BuiltInEventTypes.Teething,
                BuiltInEventTypes.Milestone, BuiltInEventTypes.Symptom, BuiltInEventTypes.Outdoor, BuiltInEventTypes.SkinCare,
            }.Select(type => type.Id));
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
    [InlineData("nasal_suction", false)]
    [InlineData("belly_massage", true)]
    [InlineData("fussy", true)]
    [InlineData("nail_trim", false)]
    [InlineData("temperature", false)]
    [InlineData("spit_up", false)]
    [InlineData("teething", false)]
    [InlineData("milestone", false)]
    [InlineData("symptom", false)]
    [InlineData("outdoor", true)]
    [InlineData("skin_care", false)]
    public void All_HasDurationPerType(string key, bool hasDuration)
    {
        Assert.Equal(hasDuration, BuiltInEventTypes.All.Single(type => type.Key.Value == key).HasDuration);
    }

    [Fact]
    public void Feeding_HasRequiredMethodAndOptionalDetailFields()
    {
        var fields = BuiltInEventTypes.Feeding.Fields;

        Assert.Equal(["method", "side", "amount_ml", "bottle_feeding_type", "formula_id", "formula_name", "breast_left_seconds", "breast_right_seconds", "food", "pause_count", "paused_seconds", "paused_at"], fields.Select(field => field.Key));
        Assert.Equal(["breast", "bottle", "solid"], fields[0].Options);
        Assert.Equal(["formula", "breast_milk"], fields[3].Options);
        Assert.Equal([true, false, false, false, false, false, false, false, false, false, false, false], fields.Select(field => field.IsRequired));
        Assert.Equal((EventFieldKind.Number, EventFieldKind.Text), (fields[2].Kind, fields[8].Kind));
        Assert.Equal((EventFieldKind.Text, true, "bottle_feeding_type"), (fields[4].Kind, fields[4].IsHidden, fields[4].VisibleWhen!.Field));
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
    public void NasalSuction_HasOptionalToolSelectAndSalineBool()
    {
        var type = BuiltInEventTypes.NasalSuction;

        Assert.Equal(("nasal_suction", "Nasal suction", "air", "#78909c"), (type.Key.Value, type.Name, type.Icon, type.Color.Value));
        Assert.Equal(
            [("tool", "Tool", EventFieldKind.Select), ("saline", "Saline used", EventFieldKind.Bool)],
            type.Fields.Select(field => (field.Key, field.Label, field.Kind)));
        Assert.Equal(["bulb", "electric", "mouth"], type.Fields[0].Options);
        Assert.All(type.Fields, field => Assert.Equal((false, false, (FieldVisibilityCondition?)null), (field.IsRequired, field.IsHidden, field.VisibleWhen)));
    }

    [Fact]
    public void BellyMassage_HasOptionalReasonAndHelpedSelectsThenPauses()
    {
        var type = BuiltInEventTypes.BellyMassage;
        var visible = type.Fields.Where(field => !field.IsHidden).ToArray();

        Assert.Equal(("belly_massage", "Belly massage", "massage", "#ff7043", true), (type.Key.Value, type.Name, type.Icon, type.Color.Value, type.HasDuration));
        Assert.Equal(
            [("reason", "Reason", EventFieldKind.Select), ("helped", "Did it help?", EventFieldKind.Select)],
            visible.Select(field => (field.Key, field.Label, field.Kind)));
        Assert.Equal(["gas", "constipation", "colic", "other"], visible[0].Options);
        Assert.Equal(["yes", "a_little", "no"], visible[1].Options);
        Assert.All(visible, field => Assert.Equal((false, (FieldVisibilityCondition?)null), (field.IsRequired, field.VisibleWhen)));
    }

    [Fact]
    public void BellyMassage_IsAHealthTypeDistinctFromBellyPain()
    {
        Assert.NotEqual(BuiltInEventTypes.BellyPain.Color.Value, BuiltInEventTypes.BellyMassage.Color.Value);
        Assert.NotEqual(BuiltInEventTypes.BellyPain.Icon, BuiltInEventTypes.BellyMassage.Icon);
        Assert.True(EventTypeIcons.IsAllowed(BuiltInEventTypes.BellyMassage.Icon));
    }

    [Fact]
    public void Fussy_HasOptionalIntensityAndWhatHelpedSelectsThenPauses()
    {
        var type = BuiltInEventTypes.Fussy;
        var visible = type.Fields.Where(field => !field.IsHidden).ToArray();

        Assert.Equal(("fussy", "Fussy / crying", "sentiment_very_dissatisfied", "#81c784", true), (type.Key.Value, type.Name, type.Icon, type.Color.Value, type.HasDuration));
        Assert.Equal(
            [("intensity", "Intensity", EventFieldKind.Select), ("what_helped", "What helped", EventFieldKind.Select)],
            visible.Select(field => (field.Key, field.Label, field.Kind)));
        Assert.Equal(["mild", "moderate", "intense"], visible[0].Options);
        Assert.Equal(["feeding", "rocking", "pacifier", "massage", "sleep", "other", "nothing"], visible[1].Options);
        Assert.All(visible, field => Assert.Equal((false, (FieldVisibilityCondition?)null), (field.IsRequired, field.VisibleWhen)));
    }

    [Fact]
    public void Fussy_HasAnAllowedIconAndAColourOfItsOwn()
    {
        Assert.True(EventTypeIcons.IsAllowed(BuiltInEventTypes.Fussy.Icon));
        Assert.Single(BuiltInEventTypes.All, type => type.Color.Value == BuiltInEventTypes.Fussy.Color.Value);
        Assert.Single(BuiltInEventTypes.All, type => type.Icon == BuiltInEventTypes.Fussy.Icon);
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
    [InlineData("belly_massage")]
    [InlineData("fussy")]
    [InlineData("outdoor")]
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
    [InlineData("nasal_suction")]
    [InlineData("nail_trim")]
    [InlineData("temperature")]
    [InlineData("spit_up")]
    [InlineData("teething")]
    [InlineData("milestone")]
    [InlineData("symptom")]
    [InlineData("skin_care")]
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

    [Theory]
    [InlineData("nail_trim", "Nail trim", "content_cut", "#5c6bc0", "where:hands,feet,both")]
    [InlineData("spit_up", "Spit-up / vomit", "sentiment_sick", "#c0ca33", "kind:spit_up,vomit|amount:little,some,a_lot")]
    [InlineData("symptom", "Symptom", "coronavirus", "#e57373", "symptom:cough,runny_nose,congestion,rash,diarrhea,constipation,other|severity:mild,moderate,severe")]
    [InlineData("outdoor", "Outdoor time", "park", "#66bb6a", "kind:sun,stroller_walk,park,other")]
    [InlineData("skin_care", "Skin care", "sanitizer", "#f48fb1", "product:moisturizer,diaper_cream,sunscreen,other")]
    public void SelectOnlyTypes_HaveTheirOptionalAlwaysVisibleSelects(string key, string name, string icon, string color, string selects)
    {
        var type = BuiltInEventTypes.All.Single(type => type.Key.Value == key);
        var visible = type.Fields.Where(field => !field.IsHidden).ToArray();

        Assert.Equal((name, icon, color), (type.Name, type.Icon, type.Color.Value));
        Assert.Equal(selects.Split('|'), visible.Select(field => $"{field.Key}:{string.Join(',', field.Options)}"));
        Assert.All(visible, field => Assert.Equal((EventFieldKind.Select, false, (FieldVisibilityCondition?)null), (field.Kind, field.IsRequired, field.VisibleWhen)));
    }

    [Fact]
    public void Temperature_HasARequiredCelsiusValueWithOneDecimalAndAnOptionalMethod()
    {
        var type = BuiltInEventTypes.Temperature;
        var value = type.Fields[0];

        Assert.Equal(("temperature", "Temperature", "thermostat", "#ffca28", false), (type.Key.Value, type.Name, type.Icon, type.Color.Value, type.HasDuration));
        Assert.Equal(("value_c", EventFieldKind.Number, true, 30m, 45m, "°C", 1, false), (value.Key, value.Kind, value.IsRequired, value.Min!.Value, value.Max!.Value, value.Unit, value.Decimals, value.IsInteger));
        Assert.Equal(("method", EventFieldKind.Select, false), (type.Fields[1].Key, type.Fields[1].Kind, type.Fields[1].IsRequired));
        Assert.Equal(["armpit", "ear", "forehead", "rectal", "mouth"], type.Fields[1].Options);
        Assert.Equal(2, type.Fields.Count);
    }

    [Fact]
    public void Teething_ToothShowsOnlyOnceAToothCameThrough()
    {
        var type = BuiltInEventTypes.Teething;

        Assert.Equal(("teething", "Teething", "dentistry", "#29b6f6"), (type.Key.Value, type.Name, type.Icon, type.Color.Value));
        Assert.Equal(["stage", "tooth"], type.Fields.Select(field => field.Key));
        Assert.Equal(["gums_sore", "tooth_came_through"], type.Fields[0].Options);
        Assert.Equal(
            ["lower_central_incisor", "upper_central_incisor", "lower_lateral_incisor", "upper_lateral_incisor", "first_molar", "canine", "second_molar", "other"],
            type.Fields[1].Options);
        Assert.Equal(("stage", "tooth_came_through"), (type.Fields[1].VisibleWhen!.Field, Assert.Single(type.Fields[1].VisibleWhen!.Values)));
        Assert.All(type.Fields, field => Assert.False(field.IsRequired));
    }

    [Fact]
    public void Milestone_CustomTextShowsOnlyForOther()
    {
        var type = BuiltInEventTypes.Milestone;

        Assert.Equal(("milestone", "Milestone", "emoji_events", "#ab47bc"), (type.Key.Value, type.Name, type.Icon, type.Color.Value));
        Assert.Equal([("milestone", EventFieldKind.Select), ("custom", EventFieldKind.Text)], type.Fields.Select(field => (field.Key, field.Kind)));
        Assert.Equal(
            ["first_smile", "laughs", "holds_head", "rolls_over", "sits", "crawls", "stands", "first_steps", "first_word", "other"],
            type.Fields[0].Options);
        Assert.Equal(("milestone", "other"), (type.Fields[1].VisibleWhen!.Field, Assert.Single(type.Fields[1].VisibleWhen!.Values)));
        Assert.All(type.Fields, field => Assert.False(field.IsRequired));
    }

    [Fact]
    public void NewTypes_HaveAllowedIconsAndColoursOfTheirOwn()
    {
        var added = new[]
        {
            BuiltInEventTypes.NailTrim, BuiltInEventTypes.Temperature, BuiltInEventTypes.SpitUp, BuiltInEventTypes.Teething,
            BuiltInEventTypes.Milestone, BuiltInEventTypes.Symptom, BuiltInEventTypes.Outdoor, BuiltInEventTypes.SkinCare,
        };

        Assert.All(added, type => Assert.True(EventTypeIcons.IsAllowed(type.Icon), type.Icon));
        Assert.All(added, type => Assert.Single(BuiltInEventTypes.All, other => other.Color.Value == type.Color.Value));
        Assert.All(added, type => Assert.Single(BuiltInEventTypes.All, other => other.Icon == type.Icon));
    }
}
