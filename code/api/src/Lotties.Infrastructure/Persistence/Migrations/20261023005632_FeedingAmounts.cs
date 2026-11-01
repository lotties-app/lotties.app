using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Seed change only: the built-in feeding type gains <c>amount_drunk_ml</c> (what the baby drank; <c>amount_ml</c>
    /// is relabelled "Amount prepared") and the hidden <c>ended_by</c> (<c>sleep</c>, set when a starting sleep stops
    /// a feeding timer). Stored events are not touched: a bottle without a drunk amount counts as fully drunk.
    /// </summary>
    public partial class FeedingAmounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount prepared\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"amount_drunk_ml\",\"label\":\"Amount drunk\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"formula_id\",\"label\":\"Formula\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"formula_name\",\"label\":\"Formula name\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}},{\"key\":\"ended_by\",\"label\":\"Ended by\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"sleep\"],\"hidden\":true},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"formula_id\",\"label\":\"Formula\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"formula_name\",\"label\":\"Formula name\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");
        }
    }
}
