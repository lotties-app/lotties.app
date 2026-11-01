using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Seed change only: the built-in fussy type's <c>what_helped</c> gains <c>diaper_change</c>, <c>burping</c> and
    /// <c>holding</c> (appended, earlier options unchanged) and the hidden optional <c>suggested_cause</c> (what
    /// "Why is she crying?" ranked first). Stored events are not touched.
    /// </summary>
    public partial class FussyOutcomes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("6191006e-8767-4cd8-882f-81898fad58d3"),
                column: "fields",
                value: "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"intense\"]},{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\",\"diaper_change\",\"burping\",\"holding\"]},{\"key\":\"suggested_cause\",\"label\":\"First suggestion\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"hunger\",\"sleepy\",\"diaper\",\"gas\",\"comfort\"],\"hidden\":true},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "event_types",
                keyColumn: "id",
                keyValue: new Guid("6191006e-8767-4cd8-882f-81898fad58d3"),
                column: "fields",
                value: "[{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"intense\"]},{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\"]},{\"key\":\"pause_count\",\"label\":\"Pauses\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":100,\"hidden\":true,\"integer\":true},{\"key\":\"paused_seconds\",\"label\":\"Paused time\",\"kind\":\"number\",\"isRequired\":false,\"min\":0,\"max\":86400,\"unit\":\"s\",\"hidden\":true,\"integer\":true},{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}]");
        }
    }
}
