using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BabyRoutine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PushNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "ak_baby_members_baby_id_user_id",
                table: "baby_members",
                columns: new[] { "baby_id", "user_id" });

            migrationBuilder.CreateTable(
                name: "baby_notification_preferences",
                columns: table => new
                {
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    dose_due = table.Column<bool>(type: "boolean", nullable: false),
                    dose_lead_minutes = table.Column<short>(type: "smallint", nullable: false),
                    nap_window = table.Column<bool>(type: "boolean", nullable: false),
                    nap_lead_minutes = table.Column<short>(type: "smallint", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_baby_notification_preferences", x => new { x.baby_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_baby_notification_preferences_baby_members_baby_id_user_id",
                        columns: x => new { x.baby_id, x.user_id },
                        principalTable: "baby_members",
                        principalColumns: new[] { "baby_id", "user_id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "job_leases",
                columns: table => new
                {
                    name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    holder_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    lease_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_job_leases", x => x.name);
                });

            migrationBuilder.CreateTable(
                name: "notification_actions",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    base_key = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    snoozed_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    snooze_count = table.Column<short>(type: "smallint", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_actions", x => new { x.user_id, x.base_key });
                });

            migrationBuilder.CreateTable(
                name: "push_subscriptions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    endpoint = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    endpoint_hash = table.Column<string>(type: "character(43)", fixedLength: true, maxLength: 43, nullable: false),
                    locale = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    device_label = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_success_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    consecutive_failures = table.Column<int>(type: "integer", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_reason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    auth = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    p256dh = table.Column<string>(type: "character varying(88)", maxLength: 88, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_push_subscriptions", x => x.id);
                    table.ForeignKey(
                        name: "fk_push_subscriptions_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_notification_settings",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    quiet_hours_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    quiet_start = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    quiet_end = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    quiet_includes_medicine = table.Column<bool>(type: "boolean", nullable: false),
                    show_names = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_notification_settings", x => x.user_id);
                    table.ForeignKey(
                        name: "fk_user_notification_settings_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notification_deliveries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    subscription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    base_key = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(124)", maxLength: 124, nullable: false),
                    due_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    attempts = table.Column<short>(type: "smallint", nullable: false),
                    next_attempt_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_status_code = table.Column<short>(type: "smallint", nullable: true),
                    action_token_hash = table.Column<string>(type: "character(43)", fixedLength: true, maxLength: 43, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_deliveries", x => x.id);
                    table.ForeignKey(
                        name: "fk_notification_deliveries_push_subscriptions_subscription_id",
                        column: x => x.subscription_id,
                        principalTable: "push_subscriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_baby_notification_preferences_baby_id",
                table: "baby_notification_preferences",
                column: "baby_id",
                filter: "dose_due OR nap_window");

            migrationBuilder.CreateIndex(
                name: "ix_notification_deliveries_created_at",
                table: "notification_deliveries",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_deliveries_status_next_attempt_at",
                table: "notification_deliveries",
                columns: new[] { "status", "next_attempt_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_deliveries_subscription_id_dedupe_key",
                table: "notification_deliveries",
                columns: new[] { "subscription_id", "dedupe_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_deliveries_user_id_base_key",
                table: "notification_deliveries",
                columns: new[] { "user_id", "base_key" });

            migrationBuilder.CreateIndex(
                name: "ix_push_subscriptions_endpoint_hash",
                table: "push_subscriptions",
                column: "endpoint_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_push_subscriptions_user_id",
                table: "push_subscriptions",
                column: "user_id",
                filter: "revoked_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "baby_notification_preferences");

            migrationBuilder.DropTable(
                name: "job_leases");

            migrationBuilder.DropTable(
                name: "notification_actions");

            migrationBuilder.DropTable(
                name: "notification_deliveries");

            migrationBuilder.DropTable(
                name: "user_notification_settings");

            migrationBuilder.DropTable(
                name: "push_subscriptions");

            migrationBuilder.DropUniqueConstraint(
                name: "ak_baby_members_baby_id_user_id",
                table: "baby_members");
        }
    }
}
