using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The per-baby appointments (docs/design/15-appointments.md): table <c>appointments</c> (never deleted, cancelled
    /// instead) with indexes on <c>(baby_id, starts_at)</c>, <c>(baby_id, updated_at)</c> and the partial
    /// <c>ix_appointments_upcoming</c> (<c>(baby_id, starts_at) WHERE status = 'upcoming'</c>) for the push scheduler.
    /// Adds <c>baby_notification_preferences.appointment_reminders</c> (bool, NOT NULL DEFAULT TRUE: stored rows get the
    /// reminders on, like members without a row) and widens the candidate index filter to it (index dropped and created
    /// again). No data is rewritten.
    /// </summary>
    public partial class Appointments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.AddColumn<bool>(
                name: "appointment_reminders",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "appointments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    duration_minutes = table.Column<int>(type: "integer", nullable: true),
                    location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    doctor_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    outcome = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reminder_offsets_minutes = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_appointments", x => x.id);
                    table.ForeignKey(
                        name: "fk_appointments_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_appointments_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders");

            migrationBuilder.CreateIndex(
                name: "ix_appointments_baby_id_starts_at",
                table: "appointments",
                columns: new[] { "baby_id", "starts_at" });

            migrationBuilder.CreateIndex(
                name: "ix_appointments_baby_id_updated_at",
                table: "appointments",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_appointments_created_by",
                table: "appointments",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_appointments_upcoming",
                table: "appointments",
                columns: new[] { "baby_id", "starts_at" },
                filter: "status = 'upcoming'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "appointments");

            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "appointment_reminders",
                table: "baby_notification_preferences");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup");
        }
    }
}
