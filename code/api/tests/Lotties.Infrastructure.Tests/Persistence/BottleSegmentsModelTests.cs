using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Migration check of the bottle segments: a seed change of the feeding type only, stored events untouched.</summary>
public sealed class BottleSegmentsModelTests
{
    [Fact]
    public void IdempotentScript_DeclaresTheHiddenSegmentsFieldWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("_BottleSegments'", StringComparison.Ordinal);
        var section = script[start..script.IndexOf("_CryDetector'", start, StringComparison.Ordinal)];

        Assert.Contains("UPDATE event_types SET fields", section, StringComparison.Ordinal);
        Assert.Contains("'e6428ccb-7061-4cf4-a5d0-67c89a396a5f'", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"ended_by\",\"label\":\"Ended by\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"sleep\"],\"hidden\":true},{\"key\":\"segments\",\"label\":\"Bottle segments\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]},\"hidden\":true},{\"key\":\"pause_count\"", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
