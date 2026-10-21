using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SleepKindBedWake : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"),
                column: "fields",
                value: "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"nap\",\"night\",\"night_waking\",\"bed_time\",\"woke_up\"]},{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false}]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"),
                column: "fields",
                value: "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"nap\",\"night\",\"night_waking\"]},{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false}]");
        }
    }
}
