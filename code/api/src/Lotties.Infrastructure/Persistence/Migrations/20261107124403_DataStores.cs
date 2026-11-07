using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DataStores : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "data_store_id",
                table: "babies",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "store_epoch",
                table: "babies",
                type: "integer",
                nullable: true,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "data_stores",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    state = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    sealed_descriptor = table.Column<byte[]>(type: "bytea", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_data_stores", x => x.id);
                    table.ForeignKey(
                        name: "fk_data_stores_users_owner_user_id",
                        column: x => x.owner_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_babies_data_store_id",
                table: "babies",
                column: "data_store_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_babies_store_epoch_present",
                table: "babies",
                sql: "store_epoch IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_data_stores_owner_user_id",
                table: "data_stores",
                column: "owner_user_id");

            migrationBuilder.AddForeignKey(
                name: "fk_babies_data_stores_data_store_id",
                table: "babies",
                column: "data_store_id",
                principalTable: "data_stores",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_babies_data_stores_data_store_id",
                table: "babies");

            migrationBuilder.DropTable(
                name: "data_stores");

            migrationBuilder.DropIndex(
                name: "ix_babies_data_store_id",
                table: "babies");

            migrationBuilder.DropCheckConstraint(
                name: "ck_babies_store_epoch_present",
                table: "babies");

            migrationBuilder.DropColumn(
                name: "data_store_id",
                table: "babies");

            migrationBuilder.DropColumn(
                name: "store_epoch",
                table: "babies");
        }
    }
}
