using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Seeds the built-in <c>belly_massage</c> type (timed; optional <c>reason</c> and <c>helped</c> selects, then the
    /// hidden pause keys). Seed only: stored events are untouched.
    /// </summary>
    public partial class BellyMassage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "event_types",
                columns: new[] { "id", "baby_id", "color", "fields", "has_duration", "icon", "key", "name" },
                values: new object[] { new Guid("44540b60-eb87-470f-8a3e-08170a525538"), null, "#ff7043", "[{\"key\":\"reason\",\"label\":\"Reason\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"gas\",\"constipation\",\"colic\",\"other\"]},{\"key\":\"helped\",\"label\":\"Did it help?\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"yes\",\"a_little\",\"no\"]},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "massage", "belly_massage", "Belly massage" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("44540b60-eb87-470f-8a3e-08170a525538"));
        }
    }
}
