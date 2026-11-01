using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProductExternalRef : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ambiguous_name",
                table: "products",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "external_ref",
                table: "products",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "inactive_since",
                table: "products",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "presentation",
                table: "products",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source",
                table: "products",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_products_source_external_ref",
                table: "products",
                columns: new[] { "source", "external_ref" },
                unique: true,
                filter: "source IS NOT NULL AND external_ref IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_products_source_external_ref",
                table: "products");

            migrationBuilder.DropColumn(
                name: "ambiguous_name",
                table: "products");

            migrationBuilder.DropColumn(
                name: "external_ref",
                table: "products");

            migrationBuilder.DropColumn(
                name: "inactive_since",
                table: "products");

            migrationBuilder.DropColumn(
                name: "presentation",
                table: "products");

            migrationBuilder.DropColumn(
                name: "source",
                table: "products");
        }
    }
}
