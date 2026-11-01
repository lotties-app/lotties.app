using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Seeds the built-in <c>nasal_suction</c> type (instant; optional <c>tool</c> select and <c>saline</c> bool).
    /// Seed only: stored events are untouched.
    /// </summary>
    public partial class NasalSuction : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "event_types",
                columns: new[] { "id", "baby_id", "color", "fields", "has_duration", "icon", "key", "name" },
                values: new object[] { new Guid("4124b99c-e000-4ee0-b74a-a6579553a450"), null, "#78909c", "[{\"key\":\"tool\",\"label\":\"Tool\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"bulb\",\"electric\",\"mouth\"]},{\"key\":\"saline\",\"label\":\"Saline used\",\"kind\":\"bool\",\"isRequired\":false}]", false, "air", "nasal_suction", "Nasal suction" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("4124b99c-e000-4ee0-b74a-a6579553a450"));
        }
    }
}
