using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Migration check of the fussy outcomes: a seed change of the fussy type only, stored events untouched.</summary>
public sealed class FussyOutcomesModelTests
{
    [Fact]
    public void IdempotentScript_AppendsWhatHelpedOptionsAndDeclaresSuggestedCauseWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_FussyOutcomes'", StringComparison.Ordinal)..];

        Assert.Contains("UPDATE event_types SET fields", section, StringComparison.Ordinal);
        Assert.Contains("'6191006e-8767-4cd8-882f-81898fad58d3'", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\",\"diaper_change\",\"burping\",\"holding\"]}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"suggested_cause\",\"label\":\"First suggestion\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hunger\",\"sleepy\",\"diaper\",\"gas\",\"comfort\"],\"hidden\":true}", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
