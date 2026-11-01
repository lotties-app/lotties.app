using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The per-baby formulas (docs/design/14-formulas.md): table <c>formulas</c> (never deleted, archived instead) with
    /// the partial unique index <c>ux_formulas_one_current_per_baby</c> (at most one current formula per baby). Seed
    /// change: the built-in feeding type declares the hidden <c>formula_id</c> and <c>formula_name</c>, shown for a bottle
    /// of formula. Stored events are not touched.
    /// </summary>
    public partial class Formulas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "formulas",
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
                    table.ForeignKey(
                        name: "fk_formulas_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_formulas_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"formula_id\",\"label\":\"Formula\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"formula_name\",\"label\":\"Formula name\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.CreateIndex(
                name: "ix_formulas_baby_id_updated_at",
                table: "formulas",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_formulas_created_by",
                table: "formulas",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ux_formulas_one_current_per_baby",
                table: "formulas",
                column: "baby_id",
                unique: true,
                filter: "is_current");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "formulas");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");
        }
    }
}
