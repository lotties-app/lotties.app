using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Migration check of the feeding amounts: a seed change of the feeding type only, stored events untouched.</summary>
public sealed class FeedingAmountsModelTests
{
    [Fact]
    public void IdempotentScript_DeclaresDrunkAmountAndEndedByWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_FeedingAmounts'", StringComparison.Ordinal)..];

        Assert.Contains("UPDATE event_types SET fields", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"amount_drunk_ml\",\"label\":\"Amount drunk\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"ended_by\",\"label\":\"Ended by\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"sleep\"],\"hidden\":true}", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
