using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Seeds eight built-in types: <c>nail_trim</c>, <c>temperature</c> (required <c>value_c</c>, 30-45 °C, one decimal
    /// place), <c>spit_up</c>, <c>teething</c> (<c>tooth</c> only once a tooth came through), <c>milestone</c>
    /// (<c>custom</c> only for "other"), <c>symptom</c>, <c>outdoor</c> (timed, with the hidden pause keys) and
    /// <c>skin_care</c>. Seed only: stored events are untouched.
    /// </summary>
    public partial class MoreEventTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "event_types",
                columns: new[] { "id", "baby_id", "color", "fields", "has_duration", "icon", "key", "name" },
                values: new object[,]
                {
                    { new Guid("0a3e94b0-55c5-4d85-b530-317f161ef0cc"), null, "#29b6f6", "[{\"key\":\"stage\",\"label\":\"Stage\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"gums_sore\",\"tooth_came_through\"]},{\"key\":\"tooth\",\"label\":\"Tooth\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"lower_central_incisor\",\"upper_central_incisor\",\"lower_lateral_incisor\",\"upper_lateral_incisor\",\"first_molar\",\"canine\",\"second_molar\",\"other\"],\"visibleWhen\":{\"field\":\"stage\",\"equals\":[\"tooth_came_through\"]}}]", false, "dentistry", "teething", "Teething" },
                    { new Guid("1a08d284-a71f-44f5-ae83-49446a6f0e3f"), null, "#c0ca33", "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"spit_up\",\"vomit\"]},{\"key\":\"amount\",\"label\":\"Amount\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"little\",\"some\",\"a_lot\"]}]", false, "sentiment_sick", "spit_up", "Spit-up / vomit" },
                    { new Guid("3491e7b4-895b-406f-885a-238da041dd7c"), null, "#ab47bc", "[{\"key\":\"milestone\",\"label\":\"Milestone\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"first_smile\",\"laughs\",\"holds_head\",\"rolls_over\",\"sits\",\"crawls\",\"stands\",\"first_steps\",\"first_word\",\"other\"]},{\"key\":\"custom\",\"label\":\"Which milestone?\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"milestone\",\"equals\":[\"other\"]}}]", false, "emoji_events", "milestone", "Milestone" },
                    { new Guid("9ad3dce5-dd4e-43d8-a022-5561ee7256ee"), null, "#f48fb1", "[{\"key\":\"product\",\"label\":\"Product\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"moisturizer\",\"diaper_cream\",\"sunscreen\",\"other\"]}]", false, "sanitizer", "skin_care", "Skin care" },
                    { new Guid("b22205ae-bae1-432f-802a-06e0c173efe1"), null, "#66bb6a", "[{\"key\":\"kind\",\"label\":\"Kind\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"sun\",\"stroller_walk\",\"park\",\"other\"]},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]", true, "park", "outdoor", "Outdoor time" },
                    { new Guid("bd1fde97-19c8-49a9-9ffd-537449183686"), null, "#5c6bc0", "[{\"key\":\"where\",\"label\":\"Where\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hands\",\"feet\",\"both\"]}]", false, "content_cut", "nail_trim", "Nail trim" },
                    { new Guid("c3691235-0279-429c-be1c-db6692ad5455"), null, "#ffca28", "[{\"key\":\"value_c\",\"label\":\"Temperature\",\"kind\":\"number\",\"isRequired\":true,\"min\":30,\"max\":45,\"unit\":\"\\u00B0C\",\"decimals\":1},{\"key\":\"method\",\"label\":\"Method\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"armpit\",\"ear\",\"forehead\",\"rectal\",\"mouth\"]}]", false, "thermostat", "temperature", "Temperature" },
                    { new Guid("fb45be64-6741-4762-ab9a-abf5c9e6a875"), null, "#e57373", "[{\"key\":\"symptom\",\"label\":\"Symptom\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"cough\",\"runny_nose\",\"congestion\",\"rash\",\"diarrhea\",\"constipation\",\"other\"]},{\"key\":\"severity\",\"label\":\"Severity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"severe\"]}]", false, "coronavirus", "symptom", "Symptom" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("0a3e94b0-55c5-4d85-b530-317f161ef0cc"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("1a08d284-a71f-44f5-ae83-49446a6f0e3f"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("3491e7b4-895b-406f-885a-238da041dd7c"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("9ad3dce5-dd4e-43d8-a022-5561ee7256ee"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("b22205ae-bae1-432f-802a-06e0c173efe1"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("bd1fde97-19c8-49a9-9ffd-537449183686"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("c3691235-0279-429c-be1c-db6692ad5455"));

            migrationBuilder.DeleteData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("fb45be64-6741-4762-ab9a-abf5c9e6a875"));
        }
    }
}
