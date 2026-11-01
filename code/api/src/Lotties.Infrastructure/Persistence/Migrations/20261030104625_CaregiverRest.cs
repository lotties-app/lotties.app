using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CaregiverRest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_rest_mornings",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    night = table.Column<DateOnly>(type: "date", nullable: false),
                    up_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_rest_mornings", x => new { x.user_id, x.night });
                    table.ForeignKey(
                        name: "fk_user_rest_mornings_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_rest_settings",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    work_windows = table.Column<string>(type: "jsonb", nullable: false),
                    night_start = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    night_end = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    fall_asleep_minutes = table.Column<int>(type: "integer", nullable: false),
                    wake_lead_minutes = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_rest_settings", x => x.user_id);
                    table.ForeignKey(
                        name: "fk_user_rest_settings_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_rest_mornings");

            migrationBuilder.DropTable(
                name: "user_rest_settings");
        }
    }
}
