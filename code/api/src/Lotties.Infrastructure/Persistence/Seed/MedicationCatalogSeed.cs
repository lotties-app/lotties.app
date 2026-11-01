using Lotties.Domain.Catalog;

namespace Lotties.Infrastructure.Persistence.Seed;

/// <summary>
/// Curated seed data of the shared medication catalog (migration <c>MedicationsPrescriptionsCatalog</c>, stable ids so
/// it is idempotent). Generic names only, each verified on the cited page; no dose, interval, age or strength
/// information. Sources and what could not be verified: <c>Seed/medication-catalog.sources.md</c>.
/// Products: none yet. No brand-to-substance mapping could be verified on ANVISA or CMED (the consultation service
/// was not reachable), so brands such as Luftal are left to the community catalog until verified.
/// </summary>
public static class MedicationCatalogSeed
{
    public static readonly DateTimeOffset SeededAt = new(2026, 10, 21, 0, 0, 0, TimeSpan.Zero);

    // DCB 8006 "simeticona" (ANVISA consolidated DCB list, https://bibliotecadigital.anvisa.gov.br/jspui/handle/anvisa/11933);
    // "Simethicone": https://medlineplus.gov/druginfo/meds/a682683.html
    public static readonly Substance Simethicone = Substance.Seed(
        new Guid("2f468145-66a8-4fad-a6c1-45ce69aaeaa3"), "simethicone", "Simethicone", "Simeticona", [], SeededAt);

    // DCB 2569 "colecalciferol" (ANVISA DCB list, as above);
    // "D3 (cholecalciferol)": https://medlineplus.gov/ency/article/002405.htm
    public static readonly Substance Cholecalciferol = Substance.Seed(
        new Guid("46e6ebde-ff2c-4e67-a132-2ff1ef9b1c66"), "cholecalciferol", "Cholecalciferol", "Colecalciferol", ["Vitamin D3"], SeededAt);

    // DCB 6827 "paracetamol" (ANVISA DCB list, as above);
    // "Acetaminophen", other name "paracetamol": https://medlineplus.gov/druginfo/meds/a681004.html
    public static readonly Substance Paracetamol = Substance.Seed(
        new Guid("1765da22-94c0-46b7-b321-4feb5f3ad86e"), "paracetamol", "Paracetamol", "Paracetamol", ["Acetaminophen"], SeededAt);

    // DCB 4766 "ibuprofeno" (ANVISA DCB list, as above);
    // "Ibuprofen": https://medlineplus.gov/druginfo/meds/a682159.html
    public static readonly Substance Ibuprofen = Substance.Seed(
        new Guid("cf40d2c1-711c-4ffa-9754-06f5c6844142"), "ibuprofen", "Ibuprofen", "Ibuprofeno", [], SeededAt);

    // DCB 3121 "dipirona" (ANVISA DCB list, as above);
    // "Metamizole = dipyrone": https://medicalguidelines.msf.org/en/viewport/EssDr/english/metamizole-dipyrone-noramidopyrine-oral-16684113.html
    public static readonly Substance Metamizole = Substance.Seed(
        new Guid("cce5fca3-cf4a-4099-b9fc-ded1a076ca1f"), "metamizole", "Metamizole", "Dipirona", ["Dipyrone"], SeededAt);

    // Current name Limosilactobacillus reuteri (basonym Lactobacillus reuteri): https://lpsn.dsmz.de/species/limosilactobacillus-reuteri
    // (not a DCB entry; scientific names are not translated)
    public static readonly Substance LimosilactobacillusReuteri = Substance.Seed(
        new Guid("d71efa75-1cb2-46fe-a019-b4d4a9df1710"), "limosilactobacillus_reuteri", "Limosilactobacillus reuteri", "Limosilactobacillus reuteri", ["Lactobacillus reuteri"], SeededAt);

    public static IReadOnlyList<Substance> Substances { get; } =
        [Simethicone, Cholecalciferol, Paracetamol, Ibuprofen, Metamizole, LimosilactobacillusReuteri];
}
