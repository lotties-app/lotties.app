using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BabyRoutine.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Seed changes only: the built-in duration types (sleep, feeding, tummy_time, breast_pump) and bath declare the
    /// hidden pause keys <c>pause_count</c>, <c>paused_seconds</c>, <c>paused_at</c>; sleep gains the optional detail
    /// fields (how_slept, fall_asleep, time_to_fall_asleep_minutes, how_woke, mood_on_wake; shown for nap and night) and
    /// its deprecated free-text <c>mood</c> becomes hidden. Stored events are not touched.
    /// </summary>
    public partial class PauseAndSleepDetailFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("543cbd04-e226-435c-9639-810ecd066056"),
                column: "fields",
                value: "[{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("5cbe3692-d4df-4d5f-85d6-2282d9733b35"),
                column: "fields",
                value: "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"nap\",\"night\",\"night_waking\",\"bed_time\",\"woke_up\",\"fell_asleep\"]},{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true},{\"key\":\"how_slept\",\"label\":\"How slept\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"in_bed\",\"nursing\",\"held\",\"next_to_me\",\"bottle\",\"stroller\",\"car\",\"swing\",\"other\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"fall_asleep\",\"label\":\"Falling asleep\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"easy\",\"took_long\",\"fussy\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"time_to_fall_asleep_minutes\",\"label\":\"Time to fall asleep\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":240,\"unit\":\"min\",\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]},\"integer\":true},{\"key\":\"how_woke\",\"label\":\"How woke\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"naturally\",\"woken\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"mood_on_wake\",\"label\":\"Mood on waking\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"good\",\"neutral\",\"bad\"],\"visibleWhen\":{\"field\":\"kind\",\"equals\":[\"nap\",\"night\"]}},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("833cf001-7e12-4bc6-b7a5-7adabb174aa5"),
                column: "fields",
                value: "[{\"key\":\"temperature_c\",\"label\":\"Water temperature\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":60,\"unit\":\"C\"},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"),
                column: "fields",
                value: "[{\"key\":\"amount_left_ml\",\"label\":\"Left amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"amount_right_ml\",\"label\":\"Right amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
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
                value: "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"nap\",\"night\",\"night_waking\",\"bed_time\",\"woke_up\",\"fell_asleep\"]},{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("833cf001-7e12-4bc6-b7a5-7adabb174aa5"),
                column: "fields",
                value: "[{\"key\":\"temperature_c\",\"label\":\"Water temperature\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":60,\"unit\":\"C\"}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("ddfdaa52-57ee-4d34-8129-a78262c2172c"),
                column: "fields",
                value: "[{\"key\":\"amount_left_ml\",\"label\":\"Left amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"},{\"key\":\"amount_right_ml\",\"label\":\"Right amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\"}]");

            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("e6428ccb-7061-4cf4-a5d0-67c89a396a5f"),
                column: "fields",
                value: "[{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":true,\"options\":[\"breast\",\"bottle\",\"solid\"]},{\"key\":\"side\",\"label\":\"Side\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"left\",\"right\",\"both\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"amount_ml\",\"label\":\"Amount\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"ml\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"bottle_feeding_type\",\"label\":\"Bottle content\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}},{\"key\":\"breast_left_seconds\",\"label\":\"Left breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"breast_right_seconds\",\"label\":\"Right breast\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"unit\":\"s\",\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"breast\"]}},{\"key\":\"food\",\"label\":\"Food\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"solid\"]}}]");
        }
    }
}
