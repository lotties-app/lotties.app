using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPredictionOutcomes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "prediction_outcomes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    predicted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    anchor_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expected_next_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    actual_next_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    error_minutes = table.Column<double>(type: "double precision", nullable: true),
                    engine_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    sample_count = table.Column<int>(type: "integer", nullable: false),
                    age_band = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    phase = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    resolved = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_prediction_outcomes", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_prediction_outcomes_baby_type_resolved",
                table: "prediction_outcomes",
                columns: new[] { "baby_id", "type_key", "resolved" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "prediction_outcomes");
        }
    }
}
