using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BuiltInFieldFixups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("318d1395-e373-4d89-a3cd-cdd7ad5187ab"),
                column: "fields",
                value: "[{\"key\":\"content\",\"label\":\"Content\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"WET\",\"DIRTY\",\"MIXED\"]}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("543cbd04-e226-435c-9639-810ecd066056"),
                column: "fields",
                value: "[{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"),
                column: "fields",
                value: "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"nap\",\"night\",\"night_waking\"]},{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("833cf001-7e12-4bc6-b7a5-7adabb174aa5"),
                column: "fields",
                value: "[{\"key\":\"temperature_c\",\"label\":\"Water temperature\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":60,\"unit\":\"C\"}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"]},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"FORMULA\",\"BREAST_MILK\"]},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\"},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\"}]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("318d1395-e373-4d89-a3cd-cdd7ad5187ab"),
                column: "fields",
                value: "[]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("543cbd04-e226-435c-9639-810ecd066056"),
                column: "fields",
                value: "[]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"),
                column: "fields",
                value: "[]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("833cf001-7e12-4bc6-b7a5-7adabb174aa5"),
                column: "fields",
                value: "[]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"]},{\"key\":\"amount\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"}]");
        }
    }
}
