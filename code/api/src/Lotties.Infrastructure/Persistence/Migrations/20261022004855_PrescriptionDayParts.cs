using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PrescriptionDayParts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "day_part_reminders",
                table: "prescriptions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "day_parts",
                table: "prescriptions",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "day_part_reminders",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "day_parts",
                table: "prescriptions");
        }
    }
}
