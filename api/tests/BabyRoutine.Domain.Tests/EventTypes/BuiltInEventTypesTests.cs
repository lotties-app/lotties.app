using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Tests.EventTypes;

public sealed class BuiltInEventTypesTests
{
    [Fact]
    public void All_ContainsSpecTemplates()
    {
        var keys = BuiltInEventTypes.All.Select(type => type.Key.Value).ToArray();

        Assert.Equal(["feeding", "sleep", "diaper", "bath", "tummy_time", "medication", "belly_pain"], keys);
    }

    [Fact]
    public void All_AreBuiltInWithUniqueStableIds()
    {
        Assert.All(BuiltInEventTypes.All, type => Assert.True(type.IsBuiltIn));
        Assert.Equal(BuiltInEventTypes.All.Count, BuiltInEventTypes.All.Select(type => type.Id).Distinct().Count());
        Assert.Equal(new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"), BuiltInEventTypes.Feeding.Id);
    }

    [Theory]
    [InlineData("feeding", true)]
    [InlineData("sleep", true)]
    [InlineData("tummy_time", true)]
    [InlineData("diaper", false)]
    [InlineData("bath", false)]
    [InlineData("medication", false)]
    [InlineData("belly_pain", false)]
    public void All_HasDurationPerType(string key, bool hasDuration)
    {
        Assert.Equal(hasDuration, BuiltInEventTypes.All.Single(type => type.Key.Value == key).HasDuration);
    }

    [Fact]
    public void Feeding_HasMethodSideAndAmountFields()
    {
        var fields = BuiltInEventTypes.Feeding.Fields;

        Assert.Equal(["method", "side", "amount"], fields.Select(field => field.Key));
        Assert.Equal(["breast", "bottle", "solid"], fields[0].Options);
        Assert.True(fields[0].IsRequired);
        Assert.Equal(EventFieldKind.Number, fields[2].Kind);
    }

    [Fact]
    public void BellyPain_HasRequiredIntensityFromOneToFive()
    {
        var intensity = Assert.Single(BuiltInEventTypes.BellyPain.Fields);

        Assert.Equal(("intensity", EventFieldKind.Number, true, 1m, 5m), (intensity.Key, intensity.Kind, intensity.IsRequired, intensity.Min, intensity.Max));
    }
}
