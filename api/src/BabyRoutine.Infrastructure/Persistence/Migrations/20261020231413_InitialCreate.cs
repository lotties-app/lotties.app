using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace BabyRoutine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "babies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    birth_date = table.Column<DateOnly>(type: "date", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_babies", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    subject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    display_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "event_types",
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
                    table.ForeignKey(
                        name: "fk_event_types_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "medications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    default_dose_amount = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    default_dose_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    is_usual = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_medications", x => x.id);
                    table.ForeignKey(
                        name: "fk_medications_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "baby_members",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_baby_members", x => x.id);
                    table.ForeignKey(
                        name: "fk_baby_members_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_baby_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "invites",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    accepted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    accepted_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_invites", x => x.id);
                    table.ForeignKey(
                        name: "fk_invites_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_invites_users_accepted_by",
                        column: x => x.accepted_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_invites_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "events",
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
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_events_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_events_event_types_type_id",
                        column: x => x.type_id,
                        principalTable: "event_types",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_events_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "event_types",
                columns: new[] { "id", "baby_id", "color", "fields", "has_duration", "icon", "key", "name" },
                values: new object[,]
                {
                    { new Guid("07a1ea45-7ba6-4fe3-9e38-a335da9ea12c"), null, "#ec407a", "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"number\",\"isRequired\":true,\"min\":1,\"max\":5}]", false, "sick", "belly_pain", "Belly pain" },
                    { new Guid("318d1395-e373-4d89-a3cd-cdd7ad5187ab"), null, "#8d6e63", "[]", false, "baby_changing_station", "diaper", "Diaper" },
                    { new Guid("543cbd04-e226-435c-9639-810ecd066056"), null, "#ffa726", "[]", true, "child_care", "tummy_time", "Tummy time" },
                    { new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"), null, "#7e57c2", "[]", true, "bedtime", "sleep", "Sleep" },
                    { new Guid("833cf001-7e12-4bc6-b7a5-7adabb174aa5"), null, "#26a69a", "[]", false, "bathtub", "bath", "Bath" },
                    { new Guid("bd43d7fb-e12c-438a-852e-c710b41a7c76"), null, "#ef5350", "[]", false, "medication", "medication", "Medication" },
                    { new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"), null, "#4f8ef7", "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"]},{\"key\":\"amount\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"}]", true, "local_drink", "feeding", "Feeding" }
                });

            migrationBuilder.CreateIndex(
                name: "ix_baby_members_baby_id_user_id",
                table: "baby_members",
                columns: new[] { "baby_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_baby_members_user_id",
                table: "baby_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_types_baby_id_key",
                table: "event_types",
                columns: new[] { "baby_id", "key" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_events_baby_id_started_at",
                table: "events",
                columns: new[] { "baby_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_events_baby_id_updated_at",
                table: "events",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_events_created_by",
                table: "events",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_events_type_id",
                table: "events",
                column: "type_id");

            migrationBuilder.CreateIndex(
                name: "ix_invites_accepted_by",
                table: "invites",
                column: "accepted_by");

            migrationBuilder.CreateIndex(
                name: "ix_invites_baby_id",
                table: "invites",
                column: "baby_id");

            migrationBuilder.CreateIndex(
                name: "ix_invites_created_by",
                table: "invites",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_invites_token",
                table: "invites",
                column: "token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_medications_baby_id",
                table: "medications",
                column: "baby_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_subject",
                table: "users",
                column: "subject",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "baby_members");

            migrationBuilder.DropTable(
                name: "events");

            migrationBuilder.DropTable(
                name: "invites");

            migrationBuilder.DropTable(
                name: "medications");

            migrationBuilder.DropTable(
                name: "event_types");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "babies");
        }
    }
}
