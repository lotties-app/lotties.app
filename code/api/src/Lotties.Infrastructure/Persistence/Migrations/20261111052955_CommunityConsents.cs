using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommunityConsents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "community_consents",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    text_version = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    policy_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    scopes = table.Column<string>(type: "jsonb", nullable: false),
                    guardian_confirmed = table.Column<bool>(type: "boolean", nullable: false),
                    locale = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_community_consents", x => x.id);
                    table.ForeignKey(
                        name: "fk_community_consents_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_community_consents_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_community_consents_baby_id_at",
                table: "community_consents",
                columns: new[] { "baby_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_community_consents_user_id",
                table: "community_consents",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "community_consents");
        }
    }
}
