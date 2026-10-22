using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Doctor access step 2 (docs/design/16-doctor-access.md section 10): creates <c>prescription_proposals</c> (indexes
    /// <c>(baby_id, updated_at)</c>, <c>(baby_id, author_user_id)</c>, <c>(baby_id, status, created_at)</c>; <c>xmin</c> row
    /// version, no column) and <c>note_reads</c> (key <c>(note_id, user_id)</c>, index <c>(baby_id, user_id, read_at)</c>);
    /// adds the provenance of prescriptions (nullable <c>prescribed_by_user_id</c>, <c>prescribed_by_name</c>,
    /// <c>proposal_id</c>, <c>original_snapshot</c> jsonb; <c>changed_by_parent</c> NOT NULL DEFAULT FALSE) and widens
    /// <c>prescriptions.instructions</c> to 2000; adds <c>baby_notification_preferences.doctor_suggestions</c> (NOT NULL
    /// DEFAULT FALSE) and widens the candidate index filter to it (index dropped and created again). Existing rows stay valid.
    /// </summary>
    public partial class DoctorProposals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.AlterColumn<string>(
                name: "instructions",
                table: "prescriptions",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000,
                oldNullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "changed_by_parent",
                table: "prescriptions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "original_snapshot",
                table: "prescriptions",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "prescribed_by_name",
                table: "prescriptions",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "prescribed_by_user_id",
                table: "prescriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "proposal_id",
                table: "prescriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "doctor_suggestions",
                table: "baby_notification_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "note_reads",
                columns: table => new
                {
                    note_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_note_reads", x => new { x.note_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_note_reads_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_note_reads_baby_notes_note_id",
                        column: x => x.note_id,
                        principalTable: "baby_notes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_note_reads_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "prescription_proposals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    medication_id = table.Column<Guid>(type: "uuid", nullable: true),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    medication_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    dose_amount = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: false),
                    dose_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    dose_per_kg = table.Column<bool>(type: "boolean", nullable: false),
                    dose_rounding_step = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    times_of_day = table.Column<string>(type: "character varying(144)", maxLength: 144, nullable: true),
                    every_minutes = table.Column<int>(type: "integer", nullable: true),
                    min_interval_minutes = table.Column<int>(type: "integer", nullable: true),
                    max_doses_per_24h = table.Column<int>(type: "integer", nullable: true),
                    indication = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    day_parts = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    day_part_reminders = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    interval_group = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    end_date = table.Column<DateOnly>(type: "date", nullable: true),
                    instructions = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    replaces_prescription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    decline_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    cancel_reason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    decided_by = table.Column<Guid>(type: "uuid", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    accepted_prescription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_prescription_proposals", x => x.id);
                    table.ForeignKey(
                        name: "fk_prescription_proposals_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_prescription_proposals_users_author_user_id",
                        column: x => x.author_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_prescription_proposals_users_decided_by",
                        column: x => x.decided_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders OR doctor_suggestions");

            migrationBuilder.CreateIndex(
                name: "ix_note_reads_baby_id_user_id_read_at",
                table: "note_reads",
                columns: new[] { "baby_id", "user_id", "read_at" });

            migrationBuilder.CreateIndex(
                name: "ix_note_reads_user_id",
                table: "note_reads",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_author_user_id",
                table: "prescription_proposals",
                column: "author_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_baby_id_author_user_id",
                table: "prescription_proposals",
                columns: new[] { "baby_id", "author_user_id" });

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_baby_id_status_created_at",
                table: "prescription_proposals",
                columns: new[] { "baby_id", "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_baby_id_updated_at",
                table: "prescription_proposals",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_decided_by",
                table: "prescription_proposals",
                column: "decided_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "note_reads");

            migrationBuilder.DropTable(
                name: "prescription_proposals");

            migrationBuilder.DropIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences");

            migrationBuilder.DropColumn(
                name: "changed_by_parent",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "original_snapshot",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "prescribed_by_name",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "prescribed_by_user_id",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "proposal_id",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "doctor_suggestions",
                table: "baby_notification_preferences");

            migrationBuilder.AlterColumn<string>(
                name: "instructions",
                table: "prescriptions",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders");
        }
    }
}
