using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>
/// Migration check of the cry detector: a seed change of the fussy type (stored events untouched) and the off-by-default
/// <c>cry_detected</c> preference, which joins the candidate index filter.
/// </summary>
public sealed class CryDetectorModelTests
{
    [Fact]
    public void Preferences_CryDetectedDefaultsToFalse()
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<BabyNotificationPreferences>().FindProperty(nameof(BabyNotificationPreferences.CryDetected))!;

        Assert.Equal(("cry_detected", false, false), (column.GetColumnName(), column.IsNullable, column.GetDefaultValue()));
    }

    [Fact]
    public void IdempotentScript_DeclaresTheMonitorMarksAddsThePreferenceAndWidensTheCandidateIndex()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_CryDetector'", StringComparison.Ordinal)..];

        Assert.Contains("UPDATE event_types SET fields", section, StringComparison.Ordinal);
        Assert.Contains("'6191006e-8767-4cd8-882f-81898fad58d3'", section, StringComparison.Ordinal);
        Assert.Contains("\"hidden\":true},{\"key\":\"auto_detected\",\"label\":\"Detected automatically\",\"kind\":\"bool\",\"isRequired\":false,\"hidden\":true},{\"key\":\"cry_confirmed\",\"label\":\"Confirmed by parent\",\"kind\":\"bool\",\"isRequired\":false,\"hidden\":true},{\"key\":\"pause_count\"", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_notification_preferences ADD cry_detected boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.True(
            section.IndexOf("DROP INDEX ix_baby_notification_preferences_baby_id;", StringComparison.Ordinal) < section.IndexOf("CREATE INDEX ix_baby_notification_preferences_baby_id", StringComparison.Ordinal),
            "the candidate index is dropped before it is created again");
        Assert.Contains("OR doctor_suggestions OR vaccine_reminders OR cry_detected;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
