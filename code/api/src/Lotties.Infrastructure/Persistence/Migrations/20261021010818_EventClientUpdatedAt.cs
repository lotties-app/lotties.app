using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Adds <c>events.client_updated_at</c> (client edit time used for last write wins). Existing rows are backfilled
    /// with their server <c>updated_at</c>, then the column becomes NOT NULL without a default.
    /// </summary>
    public partial class EventClientUpdatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "client_updated_at",
                table: "events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("UPDATE events SET client_updated_at = updated_at WHERE client_updated_at IS NULL;");

            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "client_updated_at",
                table: "events",
                type: "timestamp with time zone",
                nullable: false,
                oldClrType: typeof(DateTimeOffset),
                oldType: "timestamp with time zone",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "client_updated_at",
                table: "events");
        }
    }
}
