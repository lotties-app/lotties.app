using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BabyRoutine.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Feeding fields get visibility conditions on <c>method</c> and a <c>food</c> text field; bottle content options
    /// become lower case, and stored feeding payloads are rewritten to match (idempotent; <c>updated_at</c> is bumped so
    /// delta sync delivers the change, <c>client_updated_at</c> is kept). Seeds the built-in <c>breast_pump</c> type.
    /// </summary>
    public partial class ConditionalFieldsAndBreastPump : Migration
    {
        private const string LowerCaseBottleContents = """
            UPDATE events
            SET payload = jsonb_set(payload, '{bottle_feeding_type}', to_jsonb(lower(payload ->> 'bottle_feeding_type'))),
                updated_at = now()
            WHERE type_id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f'
              AND payload ->> 'bottle_feeding_type' IN ('FORMULA', 'BREAST_MILK');
            """;

        private const string UpperCaseBottleContents = """
            UPDATE events
            SET payload = jsonb_set(payload, '{bottle_feeding_type}', to_jsonb(upper(payload ->> 'bottle_feeding_type'))),
                updated_at = now()
            WHERE type_id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f'
              AND payload ->> 'bottle_feeding_type' IN ('formula', 'breast_milk');
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}}]");

            migrationBuilder.InsertData(
                table: "event_types",
                columns: new[] { "id", "baby_id", "color", "fields", "has_duration", "icon", "key", "name" },
                values: new object[] { new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"), null, "#26c6da", "[{\"key\":\"amount_left_ml\",\"label\":\"Left amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"amount_right_ml\",\"label\":\"Right amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"}]", true, "opacity", "breast_pump", "Breast pump" });

            migrationBuilder.Sql(LowerCaseBottleContents);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(UpperCaseBottleContents);

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"));

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"]},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"FORMULA\",\"BREAST_MILK\"]},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\"},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\"}]");
        }
    }
}
