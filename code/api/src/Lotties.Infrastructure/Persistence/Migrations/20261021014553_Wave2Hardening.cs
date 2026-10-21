using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Review wave 2: users become unique by <c>(issuer, subject)</c>; existing users get the unknown issuer
    /// <c>''</c> (a migration cannot know the configured authority) and record the token issuer on their next sign-in.
    /// Display names that are email addresses (the old fallback) become <c>Parent</c>. <c>xmin</c> row versions on
    /// <c>invites</c> and <c>babies</c> are PostgreSQL system columns: Npgsql emits no SQL for them.
    /// </summary>
    public partial class Wave2Hardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE users SET display_name = 'Parent' WHERE display_name LIKE '%@%';");

            migrationBuilder.DropIndex(
                name: "ix_users_subject",
                table: "users");

            migrationBuilder.AddColumn<string>(
                name: "issuer",
                table: "users",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "invites",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "babies",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.CreateIndex(
                name: "ix_users_issuer_subject",
                table: "users",
                columns: new[] { "issuer", "subject" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_users_issuer_subject",
                table: "users");

            migrationBuilder.DropColumn(
                name: "issuer",
                table: "users");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "invites");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "babies");

            migrationBuilder.CreateIndex(
                name: "ix_users_subject",
                table: "users",
                column: "subject",
                unique: true);
        }
    }
}
