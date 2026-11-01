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
}
