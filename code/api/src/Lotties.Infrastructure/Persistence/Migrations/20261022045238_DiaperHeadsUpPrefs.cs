using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Adds the per-member, per-baby switches of the diaper heads-ups (<c>diaper_wet_headsup</c>,
    /// <c>diaper_dirty_headsup</c>, NOT NULL DEFAULT FALSE, so stored rows stay valid and off) and widens the scheduler's
    /// candidate index filter to them. No data is rewritten.
    /// </summary>
    public partial class DiaperHeadsUpPrefs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.AddColumn<bool>(
                name: "diaper_dirty_headsup",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "diaper_wet_headsup",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "diaper_dirty_headsup",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "diaper_wet_headsup",
                table: "baby_notification_preferences");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern");
        }
    }
}
