using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunityPredictionAggregates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_retrospective",
                table: "prediction_outcomes",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_top_up",
                table: "prediction_outcomes",
                type: "boolean",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "community_prediction_aggregates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    age_band_label = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    type_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    phase = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    temporal_bucket = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    engine_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    count = table.Column<int>(type: "integer", nullable: false),
                    sum_error_minutes = table.Column<double>(type: "double precision", nullable: false),
                    sum_squared_error = table.Column<double>(type: "double precision", nullable: false),
                    median_error_minutes = table.Column<double>(type: "double precision", nullable: true),
                    p10error_minutes = table.Column<double>(type: "double precision", nullable: true),
                    p90error_minutes = table.Column<double>(type: "double precision", nullable: true),
                    generated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_community_prediction_aggregates", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_community_prediction_aggregates_dimensions",
                table: "community_prediction_aggregates",
                columns: new[] { "age_band_label", "type_key", "phase", "temporal_bucket", "engine_version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_community_prediction_aggregates_lookup",
                table: "community_prediction_aggregates",
                columns: new[] { "age_band_label", "type_key", "phase", "generated_at_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "community_prediction_aggregates");

            migrationBuilder.DropColumn(
                name: "is_retrospective",
                table: "prediction_outcomes");

            migrationBuilder.DropColumn(
                name: "is_top_up",
                table: "prediction_outcomes");
        }
    }
}
