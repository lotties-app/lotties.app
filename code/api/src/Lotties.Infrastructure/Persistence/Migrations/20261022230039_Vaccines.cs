using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Vaccinations (docs/design/18-vaccines.md): creates <c>vaccinations</c> (soft delete, indexes on
    /// <c>(baby_id, given_on)</c> and <c>(baby_id, updated_at)</c>); adds the baby's vaccine profile
    /// (<c>vaccine_profile</c> NOT NULL DEFAULT 'public', <c>gestational_age_weeks</c>, <c>rsv_maternal_vaccination</c>) and
    /// <c>baby_notification_preferences.vaccine_reminders</c> (NOT NULL DEFAULT FALSE), rebuilding the scheduler's candidate
    /// index with the new kind. No data is changed. Sorts after <c>MoreEventTypes</c>.
    /// </summary>
    public partial class Vaccines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.AddColumn<bool>(
                name: "vaccine_reminders",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<short>(
                name: "gestational_age_weeks",
                table: "babies",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "rsv_maternal_vaccination",
                table: "babies",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "vaccine_profile",
                table: "babies",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "public");

            migrationBuilder.CreateTable(
                name: "vaccinations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    vaccine_key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    dose_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    custom_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    dose_label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    given_on = table.Column<DateOnly>(type: "date", nullable: false),
                    network = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    clinic = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    lot = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    administered_by = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_vaccinations", x => x.id);
                    table.ForeignKey(
                        name: "fk_vaccinations_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_vaccinations_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders OR doctor_suggestions OR vaccine_reminders");

            migrationBuilder.CreateIndex(
                name: "ix_vaccinations_baby_id_given_on",
                table: "vaccinations",
                columns: new[] { "baby_id", "given_on" });

            migrationBuilder.CreateIndex(
                name: "ix_vaccinations_baby_id_updated_at",
                table: "vaccinations",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_vaccinations_created_by",
                table: "vaccinations",
                column: "created_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "vaccinations");

            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "vaccine_reminders",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "gestational_age_weeks",
                table: "babies");

            migrationBuilder.DropColumn(
                name: "rsv_maternal_vaccination",
                table: "babies");

            migrationBuilder.DropColumn(
                name: "vaccine_profile",
                table: "babies");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders OR doctor_suggestions");
        }
    }
}
