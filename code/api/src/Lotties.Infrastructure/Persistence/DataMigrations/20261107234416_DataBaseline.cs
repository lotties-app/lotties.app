using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Lotties.Infrastructure.Persistence.DataMigrations
{
    /// <inheritdoc />
    public partial class DataBaseline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The data chain is for a family's own database (docs/design/47-bring-your-own-database.md section 4) and never
            // runs on the Lotties database, which keeps its own chain: stop before anything is created when this database holds
            // the control tables (a schema with the control chain's history, babies and baby_members). Catalog only, so it needs
            // no right on another schema.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM pg_catalog.pg_namespace n
                        WHERE (SELECT count(DISTINCT c.relname) FROM pg_catalog.pg_class c
                               WHERE c.relnamespace = n.oid
                                 AND c.relname IN ('__EFMigrationsHistory', 'babies', 'baby_members')) = 3
                    ) THEN
                        RAISE EXCEPTION 'lotties_data_chain_on_control_database'
                            USING DETAIL = 'The data migration chain is applied only to a family''s own database, never to the Lotties database.';
                    END IF;
                END $$;
                """);

            migrationBuilder.EnsureSchema(
                name: "lotties");

            migrationBuilder.CreateTable(
                name: "appointments",
                schema: "lotties",
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
                    provider_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_appointments", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "baby_notes",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    visibility = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    body = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_baby_notes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "care_providers",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    specialty = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    registration_council = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    registration_number = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    registration_region = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    clinic_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    address = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    phone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    whatsapp = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    email = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    website = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    is_favorite = table.Column<bool>(type: "boolean", nullable: false),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_care_providers", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "event_types",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: true),
                    key = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    icon = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    color = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    has_duration = table.Column<bool>(type: "boolean", nullable: false),
                    fields = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_types", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "formulas",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    brand = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    stage = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    started_on = table.Column<DateOnly>(type: "date", nullable: true),
                    is_current = table.Column<bool>(type: "boolean", nullable: false),
                    is_archived = table.Column<bool>(type: "boolean", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_formulas", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "measurements",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    date = table.Column<DateOnly>(type: "date", nullable: false),
                    weight_kg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    height_cm = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    head_circumference_cm = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    recorded_by_doctor = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_measurements", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "medications",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    default_dose_amount = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    default_dose_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    is_usual = table.Column<bool>(type: "boolean", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_medications", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "prescription_proposals",
                schema: "lotties",
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
                });

            migrationBuilder.CreateTable(
                name: "prescriptions",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    medication_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
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
                    prescriber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    instructions = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    prescribed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    prescribed_by_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    proposal_id = table.Column<Guid>(type: "uuid", nullable: true),
                    original_snapshot = table.Column<string>(type: "jsonb", nullable: true),
                    changed_by_parent = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_prescriptions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "store_meta",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<short>(type: "smallint", nullable: false),
                    store_id = table.Column<Guid>(type: "uuid", nullable: false),
                    epoch = table.Column<Guid>(type: "uuid", nullable: false),
                    schema_version = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_store_meta", x => x.id);
                    table.CheckConstraint("ck_store_meta_single_row", "id = 1");
                });

            migrationBuilder.CreateTable(
                name: "vaccinations",
                schema: "lotties",
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
                });

            migrationBuilder.CreateTable(
                name: "note_reads",
                schema: "lotties",
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
                        name: "fk_note_reads_baby_notes_note_id",
                        column: x => x.note_id,
                        principalSchema: "lotties",
                        principalTable: "baby_notes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "events",
                schema: "lotties",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type_id = table.Column<Guid>(type: "uuid", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_events_event_types_type_id",
                        column: x => x.type_id,
                        principalSchema: "lotties",
                        principalTable: "event_types",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                schema: "lotties",
                table: "event_types",
                columns: new[] { "id", "baby_id", "color", "fields", "has_duration", "icon", "key", "name" },
                values: new object[,]
                {
                    { new Guid("07a1ea45-7ba6-4fe3-9e38-a335da9ea12c"), null, "#ec407a", "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"number\",\"isRequired\":true,\"min\":1,\"max\":5}]", false, "sick", "belly_pain", "Belly pain" },
                    { new Guid("0a3e94b0-55c5-4d85-b530-317f161ef0cc"), null, "#29b6f6", "[{\"key\":\"stage\",\"label\":\"Stage\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"gums_sore\",\"tooth_came_through\"]},{\"key\":\"tooth\",\"label\":\"Tooth\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"lower_central_incisor\",\"upper_central_incisor\",\"lower_lateral_incisor\",\"upper_lateral_incisor\",\"first_molar\",\"canine\",\"second_molar\",\"other\"],\"visibleWhen\":{\"field\":\"stage\",\"equals\":[\"tooth_came_through\"]}}]", false, "dentistry", "teething", "Teething" },
                    { new Guid("1a08d284-a71f-44f5-ae83-49446a6f0e3f"), null, "#c0ca33", "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"spit_up\",\"vomit\"]},{\"key\":\"amount\",\"label\":\"Amount\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"little\",\"some\",\"a_lot\"]}]", false, "sentiment_sick", "spit_up", "Spit-up / vomit" },
                    { new Guid("318d1395-e373-4d89-a3cd-cdd7ad5187ab"), null, "#8d6e63", "[{\"key\":\"content\",\"label\":\"Content\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"WET\",\"DIRTY\",\"MIXED\"]}]", false, "baby_changing_station", "diaper", "Diaper" },
                    { new Guid("3491e7b4-895b-406f-885a-238da041dd7c"), null, "#ab47bc", "[{\"key\":\"milestone\",\"label\":\"Milestone\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"first_smile\",\"laughs\",\"holds_head\",\"rolls_over\",\"sits\",\"crawls\",\"stands\",\"first_steps\",\"first_word\",\"other\"]},{\"key\":\"custom\",\"label\":\"Which milestone?\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"milestone\",\"equals\":[\"other\"]}}]", false, "emoji_events", "milestone", "Milestone" },
                    { new Guid("4124b99c-e000-4ee0-b74a-a6579553a450"), null, "#78909c", "[{\"key\":\"tool\",\"label\":\"Tool\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"bulb\",\"electric\",\"mouth\"]},{\"key\":\"saline\",\"label\":\"Saline used\",\"kind\":\"bool\",\"isRequired\":false}]", false, "air", "nasal_suction", "Nasal suction" },
                    { new Guid("44540b60-eb87-470f-8a3e-08170a525538"), null, "#ff7043", "[{\"key\":\"reason\",\"label\":\"Reason\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"gas\",\"constipation\",\"colic\",\"other\"]},{\"key\":\"helped\",\"label\":\"Did it help?\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"yes\",\"a_little\",\"no\"]},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "massage", "belly_massage", "Belly massage" },
                    { new Guid("543cbd04-e226-435c-9639-810ecd066056"), null, "#ffa726", "[{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "child_care", "tummy_time", "Tummy time" },
                    { new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"), null, "#7e57c2", "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"nap\",\"night\",\"night_waking\",\"bed_time\",\"woke_up\",\"fell_asleep\"]},{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true},{\"key\":\"how_slept\",\"label\":\"How slept\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"in_bed\",\"nursing\",\"held\",\"next_to_me\",\"bottle\",\"stroller\",\"car\",\"swing\",\"other\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"fall_asleep\",\"label\":\"Falling asleep\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"easy\",\"took_long\",\"fussy\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"time_to_fall_asleep_minutes\",\"label\":\"Time to fall asleep\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":240,\"unit\":\"min\",\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]},\"integer\":true},{\"key\":\"how_woke\",\"label\":\"How woke\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"naturally\",\"woken\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"mood_on_wake\",\"label\":\"Mood on waking\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"good\",\"neutral\",\"bad\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "bedtime", "sleep", "Sleep" },
                    { new Guid("6191006e-8767-4cd8-882f-81898fad58d3"), null, "#81c784", "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"intense\"]},{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\",\"diaper_change\",\"burping\",\"holding\"]},{\"key\":\"suggested_cause\",\"label\":\"First suggestion\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hunger\",\"sleepy\",\"diaper\",\"gas\",\"comfort\"],\"hidden\":true},{\"key\":\"auto_detected\",\"label\":\"Detected automatically\",\"kind\":\"bool\",\"isRequired\":false,\"hidden\":true},{\"key\":\"cry_confirmed\",\"label\":\"Confirmed by parent\",\"kind\":\"bool\",\"isRequired\":false,\"hidden\":true},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "sentiment_very_dissatisfied", "fussy", "Fussy / crying" },
                    { new Guid("833cf001-7e12-4bc6-b7a5-7adabb174aa5"), null, "#26a69a", "[{\"key\":\"temperature_c\",\"label\":\"Water temperature\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":60,\"unit\":\"C\"},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", false, "bathtub", "bath", "Bath" },
                    { new Guid("9ad3dce5-dd4e-43d8-a022-5561ee7256ee"), null, "#f48fb1", "[{\"key\":\"product\",\"label\":\"Product\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"moisturizer\",\"diaper_cream\",\"sunscreen\",\"other\"]}]", false, "sanitizer", "skin_care", "Skin care" },
                    { new Guid("b22205ae-bae1-432f-802a-06e0c173efe1"), null, "#66bb6a", "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"sun\",\"stroller_walk\",\"park\",\"other\"]},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "park", "outdoor", "Outdoor time" },
                    { new Guid("bd1fde97-19c8-49a9-9ffd-537449183686"), null, "#5c6bc0", "[{\"key\":\"where\",\"label\":\"Where\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hands\",\"feet\",\"both\"]}]", false, "content_cut", "nail_trim", "Nail trim" },
                    { new Guid("bd43d7fb-e12c-438a-852e-c710b41a7c76"), null, "#ef5350", "[]", false, "medication", "medication", "Medication" },
                    { new Guid("c3691235-0279-429c-be1c-db6692ad5455"), null, "#ffca28", "[{\"key\":\"value_c\",\"label\":\"Temperature\",\"kind\":\"number\",\"isRequired\":true,\"min\":30,\"max\":45,\"unit\":\"\\u00B0C\",\"decimals\":1},{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"armpit\",\"ear\",\"forehead\",\"rectal\",\"mouth\"]}]", false, "thermostat", "temperature", "Temperature" },
                    { new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"), null, "#26c6da", "[{\"key\":\"amount_left_ml\",\"label\":\"Left amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"amount_right_ml\",\"label\":\"Right amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "opacity", "breast_pump", "Breast pump" },
                    { new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"), null, "#4f8ef7", "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount prepared\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"amount_drunk_ml\",\"label\":\"Amount drunk\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"formula_id\",\"label\":\"Formula\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"formula_name\",\"label\":\"Formula name\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}},{\"key\":\"ended_by\",\"label\":\"Ended by\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"sleep\"],\"hidden\":true},{\"key\":\"segments\",\"label\":\"Bottle segments\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]},\"hidden\":true},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "local_drink", "feeding", "Feeding" },
                    { new Guid("fb45be64-6741-4762-ab9a-abf5c9e6a875"), null, "#e57373", "[{\"key\":\"symptom\",\"label\":\"Symptom\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"cough\",\"runny_nose\",\"congestion\",\"rash\",\"diarrhea\",\"constipation\",\"other\"]},{\"key\":\"severity\",\"label\":\"Severity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"severe\"]}]", false, "coronavirus", "symptom", "Symptom" }
                });

            migrationBuilder.CreateIndex(
                name: "ix_appointments_baby_id_starts_at",
                schema: "lotties",
                table: "appointments",
                columns: new[] { "baby_id", "starts_at" });

            migrationBuilder.CreateIndex(
                name: "ix_appointments_baby_id_updated_at",
                schema: "lotties",
                table: "appointments",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_appointments_created_by",
                schema: "lotties",
                table: "appointments",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_appointments_upcoming",
                schema: "lotties",
                table: "appointments",
                columns: new[] { "baby_id", "starts_at" },
                filter: "status = 'upcoming'");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notes_author_user_id",
                schema: "lotties",
                table: "baby_notes",
                column: "author_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_baby_notes_baby_id_updated_at",
                schema: "lotties",
                table: "baby_notes",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_care_providers_baby_id_updated_at",
                schema: "lotties",
                table: "care_providers",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_care_providers_created_by",
                schema: "lotties",
                table: "care_providers",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_event_types_baby_id_key",
                schema: "lotties",
                table: "event_types",
                columns: new[] { "baby_id", "key" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_events_baby_id_started_at",
                schema: "lotties",
                table: "events",
                columns: new[] { "baby_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_events_baby_id_updated_at",
                schema: "lotties",
                table: "events",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_events_created_by",
                schema: "lotties",
                table: "events",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_events_type_id",
                schema: "lotties",
                table: "events",
                column: "type_id");

            migrationBuilder.CreateIndex(
                name: "ix_formulas_baby_id_updated_at",
                schema: "lotties",
                table: "formulas",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_formulas_created_by",
                schema: "lotties",
                table: "formulas",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ux_formulas_one_current_per_baby",
                schema: "lotties",
                table: "formulas",
                column: "baby_id",
                unique: true,
                filter: "is_current");

            migrationBuilder.CreateIndex(
                name: "ix_measurements_baby_id_date",
                schema: "lotties",
                table: "measurements",
                columns: new[] { "baby_id", "date" });

            migrationBuilder.CreateIndex(
                name: "ix_measurements_created_by",
                schema: "lotties",
                table: "measurements",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_medications_baby_id",
                schema: "lotties",
                table: "medications",
                column: "baby_id");

            migrationBuilder.CreateIndex(
                name: "ix_medications_product_id",
                schema: "lotties",
                table: "medications",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_note_reads_baby_id_user_id_read_at",
                schema: "lotties",
                table: "note_reads",
                columns: new[] { "baby_id", "user_id", "read_at" });

            migrationBuilder.CreateIndex(
                name: "ix_note_reads_user_id",
                schema: "lotties",
                table: "note_reads",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_author_user_id",
                schema: "lotties",
                table: "prescription_proposals",
                column: "author_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_baby_id_author_user_id",
                schema: "lotties",
                table: "prescription_proposals",
                columns: new[] { "baby_id", "author_user_id" });

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_baby_id_status_created_at",
                schema: "lotties",
                table: "prescription_proposals",
                columns: new[] { "baby_id", "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_baby_id_updated_at",
                schema: "lotties",
                table: "prescription_proposals",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_prescription_proposals_decided_by",
                schema: "lotties",
                table: "prescription_proposals",
                column: "decided_by");

            migrationBuilder.CreateIndex(
                name: "ix_prescriptions_baby_id_medication_id",
                schema: "lotties",
                table: "prescriptions",
                columns: new[] { "baby_id", "medication_id" });

            migrationBuilder.CreateIndex(
                name: "ix_prescriptions_baby_id_updated_at",
                schema: "lotties",
                table: "prescriptions",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_prescriptions_created_by",
                schema: "lotties",
                table: "prescriptions",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_vaccinations_baby_id_given_on",
                schema: "lotties",
                table: "vaccinations",
                columns: new[] { "baby_id", "given_on" });

            migrationBuilder.CreateIndex(
                name: "ix_vaccinations_baby_id_updated_at",
                schema: "lotties",
                table: "vaccinations",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_vaccinations_created_by",
                schema: "lotties",
                table: "vaccinations",
                column: "created_by");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "appointments",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "care_providers",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "events",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "formulas",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "measurements",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "medications",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "note_reads",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "prescription_proposals",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "prescriptions",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "store_meta",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "vaccinations",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "event_types",
                schema: "lotties");

            migrationBuilder.DropTable(
                name: "baby_notes",
                schema: "lotties");
        }
    }
}
