using System.Text.Json.Nodes;
using Lotties.Domain.Units;

namespace Lotties.Domain.Tests.Units;

/// <summary>
/// The measurement-units vectors shared with the web port (code/web/src/units/unitsVectors.json, linked into the test output;
/// the web runs them in its own tests): both sides must give the same locale resolution and the same rounded conversions.
/// </summary>
public sealed class UnitVectorTests
{
    private static readonly Lazy<JsonObject> Vectors = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Units", "unitsVectors.json")))!.AsObject());

    private static IEnumerable<JsonObject> Cases(string group) => Vectors.Value[group]!.AsArray().Select(node => node!.AsObject());

    private static decimal Number(JsonObject item, string key) => item[key]!.GetValue<decimal>();

    [Fact]
    public void Vectors_AreNotEmpty()
    {
        foreach (var group in new[] { "resolve", "volumeMlToOz", "volumeOzToMl", "weightKgToLbOz", "weightLbOzToKg", "lengthCmToIn", "lengthInToCm", "temperatureCToF", "temperatureFToC" })
        {
            Assert.NotEmpty(Cases(group));
        }
    }

    [Fact]
    public void Resolve_SharedVectors()
    {
        foreach (var item in Cases("resolve"))
        {
            Assert.True(UnitSystems.TryParse(item["setting"]!.GetValue<string>(), out var setting));
            var expected = item["expect"]!.GetValue<string>();
            Assert.Equal(expected, UnitSystems.Resolve(setting, item["locale"]!.GetValue<string>()) == UnitSystem.Us ? "us" : "metric");
        }
    }

    [Fact]
    public void VolumeMlToOz_SharedVectors()
    {
        foreach (var item in Cases("volumeMlToOz"))
        {
            Assert.Equal(item["text"]!.GetValue<string>(), UnitConversions.Text(UnitConversions.MlToFluidOunces(Number(item, "ml"))));
        }
    }

    [Fact]
    public void VolumeOzToMl_SharedVectors()
    {
        foreach (var item in Cases("volumeOzToMl"))
        {
            Assert.Equal((int)Number(item, "ml"), UnitConversions.FluidOuncesToMl(Number(item, "oz")));
        }
    }

    [Fact]
    public void WeightKgToLbOz_SharedVectors()
    {
        foreach (var item in Cases("weightKgToLbOz"))
        {
            var weight = UnitConversions.KgToPoundsOunces(Number(item, "kg"));
            Assert.Equal((int)Number(item, "lb"), weight.Pounds);
            Assert.Equal((int)Number(item, "oz"), weight.Ounces);
            var text = weight.Pounds == 0 ? $"{weight.Ounces} oz" : $"{weight.Pounds} lb {weight.Ounces} oz";
            Assert.Equal(item["text"]!.GetValue<string>(), text);
        }
    }

    [Fact]
    public void WeightLbOzToKg_SharedVectors()
    {
        foreach (var item in Cases("weightLbOzToKg"))
        {
            Assert.Equal(Number(item, "kg"), UnitConversions.PoundsOuncesToKg((int)Number(item, "lb"), Number(item, "oz")));
        }
    }

    [Fact]
    public void LengthCmToIn_SharedVectors()
    {
        foreach (var item in Cases("lengthCmToIn"))
        {
            Assert.Equal(item["text"]!.GetValue<string>(), UnitConversions.Text(UnitConversions.CmToInches(Number(item, "cm"))));
        }
    }

    [Fact]
    public void LengthInToCm_SharedVectors()
    {
        foreach (var item in Cases("lengthInToCm"))
        {
            Assert.Equal(Number(item, "cm"), UnitConversions.InchesToCm(Number(item, "in")));
        }
    }

    [Fact]
    public void TemperatureCToF_SharedVectors()
    {
        foreach (var item in Cases("temperatureCToF"))
        {
            Assert.Equal(item["text"]!.GetValue<string>(), UnitConversions.Text(UnitConversions.CelsiusToFahrenheit(Number(item, "c"))));
        }
    }

    [Fact]
    public void TemperatureFToC_SharedVectors()
    {
        foreach (var item in Cases("temperatureFToC"))
        {
            Assert.Equal(Number(item, "c"), UnitConversions.FahrenheitToCelsius(Number(item, "f")));
        }
    }

    [Theory]
    [InlineData("auto", UnitSetting.Auto)]
    [InlineData("METRIC", UnitSetting.Metric)]
    [InlineData(" us ", UnitSetting.Us)]
    public void TryParse_KnownNames(string name, UnitSetting expected)
    {
        Assert.True(UnitSystems.TryParse(name, out var setting));
        Assert.Equal(expected, setting);
        Assert.Equal(expected.ToString().ToLowerInvariant(), UnitSystems.NameOf(setting));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("imperial")]
    public void TryParse_UnknownNames_AreRefused(string? name) => Assert.False(UnitSystems.TryParse(name, out _));

    [Theory]
    [InlineData("pt_BR", "metric")]
    [InlineData("en-LR", "us")]
    [InlineData("my-MM", "us")]
    [InlineData("zh-Hans-US", "us")]
    [InlineData("garbage", "metric")]
    public void Resolve_Auto_ReadsTheRegion(string tag, string expected) =>
        Assert.Equal(expected, UnitSystems.Resolve(UnitSetting.Auto, tag) == UnitSystem.Us ? "us" : "metric");
}
