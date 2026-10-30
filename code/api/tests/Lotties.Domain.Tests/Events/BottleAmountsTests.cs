using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Events;

/// <summary><see cref="BottleAmounts.EnsureDrunkWithinPrepared"/>: drunk is never above prepared; missing amounts are fine.</summary>
public sealed class BottleAmountsTests
{
    [Theory]
    [InlineData("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":80}""")]
    [InlineData("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":120}""")]
    [InlineData("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":0}""")]
    [InlineData("""{"method":"bottle","amount_ml":120}""")]
    [InlineData("""{"method":"bottle","amount_drunk_ml":80}""")]
    [InlineData("""{"method":"bottle","amount_ml":null,"amount_drunk_ml":80}""")]
    [InlineData("""{"method":"solid","food":"Banana"}""")]
    public void EnsureDrunkWithinPrepared_Accepts(string json)
    {
        BottleAmounts.EnsureDrunkWithinPrepared(EventPayload.From(json));
    }

    [Fact]
    public void EnsureDrunkWithinPrepared_DrunkAbovePrepared_IsRejectedOnTheDrunkField()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            BottleAmounts.EnsureDrunkWithinPrepared(EventPayload.From("""{"method":"bottle","amount_ml":100,"amount_drunk_ml":100.5}""")));

        Assert.Equal("amount_drunk_ml", exception.Field);
    }

    /// <summary>The same cases as the web's <c>drunkMl</c> (code/web/src/events/bottleAmounts.ts).</summary>
    [Theory]
    [InlineData("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":80}""", 80d)]
    [InlineData("""{"method":"bottle","amount_ml":90,"bottle_feeding_type":"breast_milk"}""", 90d)]
    [InlineData("""{"method":"bottle","amount_ml":60}""", 60d)]
    [InlineData("""{"method":"bottle","amount_ml":100,"amount_drunk_ml":130}""", 100d)]
    [InlineData("""{"method":"bottle","amount_drunk_ml":70}""", 70d)]
    [InlineData("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":0}""", 0d)]
    [InlineData("""{"method":"bottle","amount_ml":-5}""", null)]
    [InlineData("""{"method":"bottle","amount_ml":"120"}""", null)]
    [InlineData("""{"method":"bottle"}""", null)]
    [InlineData("""[1,2]""", null)]
    public void DrunkMl_IsTheDrunkAmountElsePrepared(string json, double? expected) =>
        Assert.Equal(expected, BottleAmounts.DrunkMl(System.Text.Json.JsonDocument.Parse(json).RootElement));
}
