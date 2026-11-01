using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Adds the per-member, per-baby switches of the overtired and fussy pattern heads-ups (<c>overtired_warning</c>,
    /// <c>fussy_pattern</c>, NOT NULL DEFAULT FALSE, so stored rows stay valid and off) and widens the scheduler's
    /// candidate index filter to them. No data is rewritten.
    /// </summary>
    public partial class FussyAndOvertiredPrefs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.AddColumn<bool>(
                name: "fussy_pattern",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "overtired_warning",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "fussy_pattern",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "overtired_warning",
                table: "baby_notification_preferences");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern");
        }
    }
}
