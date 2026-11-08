using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DataStoreMoves : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "data_store_moves",
                columns: table => new
                {
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    direction = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    source_store_id = table.Column<Guid>(type: "uuid", nullable: true),
                    target_store_id = table.Column<Guid>(type: "uuid", nullable: true),
                    state = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    attempt = table.Column<int>(type: "integer", nullable: false),
                    lease_holder = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    lease_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    records_copied = table.Column<int>(type: "integer", nullable: false),
                    records_total = table.Column<int>(type: "integer", nullable: true),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    moved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    old_copy_delete_after = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    old_copy_deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    leftovers_pending = table.Column<bool>(type: "boolean", nullable: false),
                    next_cleanup_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    failure_code = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_data_store_moves", x => x.baby_id);
                    table.ForeignKey(
                        name: "fk_data_store_moves_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "data_store_moves");
        }
    }
}
