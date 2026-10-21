using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Lotties.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MedicationsPrescriptionsCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "product_id",
                table: "medications",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "prescriptions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    baby_id = table.Column<Guid>(type: "uuid", nullable: false),
                    medication_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    dose_amount = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: false),
                    dose_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    dose_per_kg = table.Column<bool>(type: "boolean", nullable: false),
                    dose_rounding_step = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    times_of_day = table.Column<string>(type: "character varying(144)", maxLength: 144, nullable: true),
                    every_minutes = table.Column<int>(type: "integer", nullable: true),
                    min_interval_minutes = table.Column<int>(type: "integer", nullable: true),
                    max_doses_per_24h = table.Column<int>(type: "integer", nullable: true),
                    indication = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    interval_group = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    end_date = table.Column<DateOnly>(type: "date", nullable: true),
                    prescriber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    instructions = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_prescriptions", x => x.id);
                    table.ForeignKey(
                        name: "fk_prescriptions_babies_baby_id",
                        column: x => x.baby_id,
                        principalTable: "babies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_prescriptions_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "products",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    form = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    country = table.Column<string>(type: "character(2)", fixedLength: true, maxLength: 2, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    merged_into_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_products", x => x.id);
                    table.ForeignKey(
                        name: "fk_products_products_merged_into_id",
                        column: x => x.merged_into_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_products_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "substances",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    name_en = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name_pt_br = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    synonyms = table.Column<string>(type: "character varying(520)", maxLength: 520, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_substances", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "product_substances",
                columns: table => new
                {
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    substance_id = table.Column<Guid>(type: "uuid", nullable: false),
                    strength_amount = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    strength_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    strength_per_amount = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    strength_per_unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_product_substances", x => new { x.product_id, x.substance_id });
                    table.ForeignKey(
                        name: "fk_product_substances_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_product_substances_substances_substance_id",
                        column: x => x.substance_id,
                        principalTable: "substances",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "substances",
                columns: new[] { "id", "created_at", "key", "name_en", "name_pt_br", "synonyms" },
                values: new object[,]
                {
                    { new Guid("1765da22-94c0-46b7-b321-4feb5f3ad86e"), new DateTimeOffset(new DateTime(2026, 10, 21, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "paracetamol", "Paracetamol", "Paracetamol", "Acetaminophen" },
                    { new Guid("2f468145-66a8-4fad-a6c1-45ce69aaeaa3"), new DateTimeOffset(new DateTime(2026, 10, 21, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "simethicone", "Simethicone", "Simeticona", "" },
                    { new Guid("46e6ebde-ff2c-4e67-a132-2ff1ef9b1c66"), new DateTimeOffset(new DateTime(2026, 10, 21, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "cholecalciferol", "Cholecalciferol", "Colecalciferol", "Vitamin D3" },
                    { new Guid("cce5fca3-cf4a-4099-b9fc-ded1a076ca1f"), new DateTimeOffset(new DateTime(2026, 10, 21, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "metamizole", "Metamizole", "Dipirona", "Dipyrone" },
                    { new Guid("cf40d2c1-711c-4ffa-9754-06f5c6844142"), new DateTimeOffset(new DateTime(2026, 10, 21, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "ibuprofen", "Ibuprofen", "Ibuprofeno", "" },
                    { new Guid("d71efa75-1cb2-46fe-a019-b4d4a9df1710"), new DateTimeOffset(new DateTime(2026, 10, 21, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "limosilactobacillus_reuteri", "Limosilactobacillus reuteri", "Limosilactobacillus reuteri", "Lactobacillus reuteri" }
                });

            migrationBuilder.CreateIndex(
                name: "ix_medications_product_id",
                table: "medications",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_prescriptions_baby_id_medication_id",
                table: "prescriptions",
                columns: new[] { "baby_id", "medication_id" });

            migrationBuilder.CreateIndex(
                name: "ix_prescriptions_baby_id_updated_at",
                table: "prescriptions",
                columns: new[] { "baby_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_prescriptions_created_by",
                table: "prescriptions",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_product_substances_substance_id",
                table: "product_substances",
                column: "substance_id");

            migrationBuilder.CreateIndex(
                name: "ix_products_created_by",
                table: "products",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_products_merged_into_id",
                table: "products",
                column: "merged_into_id");

            migrationBuilder.CreateIndex(
                name: "ix_products_normalized_name_form_country",
                table: "products",
                columns: new[] { "normalized_name", "form", "country" },
                unique: true,
                filter: "merged_into_id IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_substances_key",
                table: "substances",
                column: "key",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_medications_products_product_id",
                table: "medications",
                column: "product_id",
                principalTable: "products",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_medications_products_product_id",
                table: "medications");

            migrationBuilder.DropTable(
                name: "prescriptions");

            migrationBuilder.DropTable(
                name: "product_substances");

            migrationBuilder.DropTable(
                name: "products");

            migrationBuilder.DropTable(
                name: "substances");

            migrationBuilder.DropIndex(
                name: "ix_medications_product_id",
                table: "medications");

            migrationBuilder.DropColumn(
                name: "product_id",
                table: "medications");
        }
    }
}
