using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PrivacyFirstOnboarding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "role_label",
                table: "users",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "specialty",
                table: "professional_profiles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "share_display_name",
                table: "professional_profiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "share_registration",
                table: "professional_profiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Profiles that exist keep what families already see; new ones share nothing until she opts in.
            migrationBuilder.Sql("UPDATE professional_profiles SET share_display_name = (display_name <> ''), share_registration = (registration_number IS NOT NULL)");

            migrationBuilder.AddColumn<bool>(
                name: "birth_date_week_only",
                table: "babies",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "label",
                table: "babies",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "role_label",
                table: "users");

            migrationBuilder.DropColumn(
                name: "share_display_name",
                table: "professional_profiles");

            migrationBuilder.DropColumn(
                name: "share_registration",
                table: "professional_profiles");

            migrationBuilder.DropColumn(
                name: "birth_date_week_only",
                table: "babies");

            migrationBuilder.DropColumn(
                name: "label",
                table: "babies");

            migrationBuilder.AlterColumn<string>(
                name: "specialty",
                table: "professional_profiles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);
        }
    }
}
