using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProjectBoard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "board_api_keys",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    prefix = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    key_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    allowed_topics = table.Column<string>(type: "character varying(411)", maxLength: 411, nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    use_count = table.Column<long>(type: "bigint", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_board_api_keys", x => x.id);
                    table.ForeignKey(
                        name: "fk_board_api_keys_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "board_topics",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    archived = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_board_topics", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "board_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    topic_key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    side = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    priority = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    labels = table.Column<string>(type: "character varying(411)", maxLength: 411, nullable: false),
                    due_date = table.Column<DateOnly>(type: "date", nullable: true),
                    links = table.Column<string>(type: "jsonb", nullable: false),
                    pinned = table.Column<bool>(type: "boolean", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    decision_summary = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    rationale = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    source = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    external_key = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    imported_version = table.Column<int>(type: "integer", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_key_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_board_items", x => x.id);
                    table.ForeignKey(
                        name: "fk_board_items_board_api_keys_created_by_key_id",
                        column: x => x.created_by_key_id,
                        principalTable: "board_api_keys",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_board_items_board_topics_topic_key",
                        column: x => x.topic_key,
                        principalTable: "board_topics",
                        principalColumn: "key",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_board_items_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "board_item_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    item_id = table.Column<Guid>(type: "uuid", nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor_kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_key_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    changes = table.Column<string>(type: "jsonb", nullable: false),
                    comment = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_board_item_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_board_item_events_board_api_keys_actor_key_id",
                        column: x => x.actor_key_id,
                        principalTable: "board_api_keys",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_board_item_events_board_items_item_id",
                        column: x => x.item_id,
                        principalTable: "board_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_board_item_events_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "board_topics",
                columns: new[] { "key", "archived", "created_at", "description", "name", "sort_order", "updated_at" },
                values: new object[,]
                {
                    { "assistants-alexa-mcp", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Voice and AI assistants.", "Assistants (Alexa, MCP)", 30, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "data-catalog", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Medicine catalog, vaccine schedule, age norms, imports.", "Data and catalog", 70, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "design-ux", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Visual identity, interaction, accessibility, copy.", "Design and UX", 90, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "doctor-access", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "The Doctor role, sections, the doctor's dashboard.", "Doctor access", 20, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "infrastructure-deploy", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Home lab, Keycloak, database, backups, deploys.", "Infrastructure and deploy", 60, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "mobile-stores", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Capacitor apps, App Store and Google Play.", "Mobile and stores", 50, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "predictions-ml", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Heuristics, benchmarks, the cry detector.", "Predictions and ML", 80, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "privacy-legal", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Privacy policy, LGPD, consent, retention, the owner checklist.", "Privacy and legal", 40, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "process-meta", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "How the owner and the assistants work: worktrees, reviews, this board.", "Process and meta", 100, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) },
                    { "product", false, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Features, behaviour and scope of the app.", "Product", 10, new DateTimeOffset(new DateTime(2026, 10, 24, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)) }
                });

            migrationBuilder.CreateIndex(
                name: "ix_board_api_keys_created_by_user_id",
                table: "board_api_keys",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_api_keys_key_hash",
                table: "board_api_keys",
                column: "key_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_board_api_keys_prefix",
                table: "board_api_keys",
                column: "prefix");

            migrationBuilder.CreateIndex(
                name: "ix_board_item_events_actor_key_id",
                table: "board_item_events",
                column: "actor_key_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_item_events_actor_user_id",
                table: "board_item_events",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_item_events_item_id_at",
                table: "board_item_events",
                columns: new[] { "item_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_board_items_created_by_key_id",
                table: "board_items",
                column: "created_by_key_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_items_created_by_user_id",
                table: "board_items",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_items_external_key",
                table: "board_items",
                column: "external_key",
                unique: true,
                filter: "external_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_board_items_topic_key_updated_at",
                table: "board_items",
                columns: new[] { "topic_key", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_board_items_updated_at",
                table: "board_items",
                column: "updated_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "board_item_events");

            migrationBuilder.DropTable(
                name: "board_items");

            migrationBuilder.DropTable(
                name: "board_api_keys");

            migrationBuilder.DropTable(
                name: "board_topics");
        }
    }
}
