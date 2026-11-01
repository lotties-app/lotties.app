using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The cry detector (docs/design/31-cry-detector-spike.md, CD4 and CD6): the built-in fussy type gains the hidden
    /// optional booleans <c>auto_detected</c> and <c>cry_confirmed</c> after <c>suggested_cause</c> (a seed change; stored
    /// events are not touched), and the per-baby notification preferences gain <c>cry_detected</c> (off by default), which
    /// joins the filter of the scheduler's candidate index.
    /// </summary>
    public partial class CryDetector : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.AddColumn<bool>(
                name: "cry_detected",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("6191006e-8767-4cd8-882f-81898fad58d3"),
                column: "fields",
                value: "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"intense\"]},{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\",\"diaper_change\",\"burping\",\"holding\"]},{\"key\":\"suggested_cause\",\"label\":\"First suggestion\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hunger\",\"sleepy\",\"diaper\",\"gas\",\"comfort\"],\"hidden\":true},{\"key\":\"auto_detected\",\"label\":\"Detected automatically\",\"kind\":\"bool\",\"isRequired\":false,\"hidden\":true},{\"key\":\"cry_confirmed\",\"label\":\"Confirmed by parent\",\"kind\":\"bool\",\"isRequired\":false,\"hidden\":true},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders OR doctor_suggestions OR vaccine_reminders OR cry_detected");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "cry_detected",
                table: "baby_notification_preferences");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("6191006e-8767-4cd8-882f-81898fad58d3"),
                column: "fields",
                value: "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"intense\"]},{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\",\"diaper_change\",\"burping\",\"holding\"]},{\"key\":\"suggested_cause\",\"label\":\"First suggestion\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hunger\",\"sleepy\",\"diaper\",\"gas\",\"comfort\"],\"hidden\":true},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders OR doctor_suggestions OR vaccine_reminders");
        }
    }
}
