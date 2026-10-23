using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Infrastructure.Catalog.Official;

namespace Lotties.CatalogImporter;

/// <summary>Prints the plan report, the curated list, the spot-check lookups and the import result (no credentials, no personal data).</summary>
internal sealed class ReportPrinter(TextWriter output)
{
    private const int LookupMax = 20;

    public void Sources(SourceRows<AnvisaRegistrationRow> registrations, DecodedSource registrationText, SourceRows<CmedPresentationRow>? presentations, DecodedSource? presentationText)
    {
        output.WriteLine($"Registrations file: {registrations.Rows.Count:N0} rows, encoding {registrationText.EncodingName}, delimiter '{registrations.Delimiter}', {registrations.ShortRecords:N0} short records skipped");
        output.WriteLine(presentations is null
            ? "Price list: not used (--forms-source none): every product gets the form \"other\""
            : $"Price list: {presentations.Rows.Count:N0} presentations, encoding {presentationText?.EncodingName}, delimiter '{presentations.Delimiter}', {presentations.ShortRecords:N0} short records skipped");
    }

    public void Plan(OfficialCatalogPlan plan)
    {
        var report = plan.Report;
        output.WriteLine();
        output.WriteLine("== Official plan (ANVISA)");
        Line("source rows", report.SourceRows);
        Line("rows without registration number (notified products)", report.RowsWithoutRegistration);
        Line("  active ones, imported by name (ingredient only if their own row lists it)", report.ActiveNotifiedRows);
        Line("registrations", report.Registrations);
        Line("  active (imported)", report.ActiveRegistrations);
        Line("  without an active row (left out; their rows only feed ingredient inheritance)", report.ExcludedRegistrations);
        Line("    of which still priced by CMED", report.ExcludedPricedRegistrations);
        Line("  active with the ingredient inherited from another row of the same registration", report.InheritedIngredientRegistrations);
        Line("  active without any ingredient in any row", report.RegistrationsWithoutIngredients);
        Line("  active without CMED presentation (form other)", report.RegistrationsWithoutPresentations);
        Line("  skipped: name without letters or digits", report.SkippedNames);
        Line("CMED presentations", report.PresentationRows);
        Line("  of registrations not imported", report.PresentationsWithoutRegistration);
        Line("products", report.Products);
        foreach (var (form, count) in report.ProductsByForm)
        {
            Line($"  {OfficialCatalogPlanner.FormCode(form)}", count);
        }

        Line("products without ingredient (shown as 'Ingredient not listed in the official data')", report.ProductsWithoutIngredients);
        Line("ambiguous names (one name, different ingredient sets: split into variants)", report.AmbiguousNames);
        Line("  products that are variants of an ambiguous name", report.AmbiguousProducts);
        Line("other-form fallbacks dropped (same name and ingredients have a real form)", report.DroppedFallbacks);
        Line($"products with more than {Product.OfficialMaxSubstances} ingredients (kept without links)", report.ProductsWithTooManyIngredients);
        Line("products with dosage text moved out of the name", report.NamesWithPresentation);
        Line("substances", report.Substances);
        Line("  curated (English name from the map)", report.CuratedSubstances);
        Samples("Presentations mapped to \"other\" (pattern: count)", report.OtherFormSamples.Select(sample => $"{sample.Text}: {sample.Count:N0}"));
        Samples("Multi-ingredient products", report.MultiIngredientSamples);
        Samples("Names with dosage moved to presentation", report.PresentationSplitSamples);
        Samples("Ambiguous names (variants)", report.AmbiguousNameSamples);
    }

    public void Curated(CuratedCatalogPlan curated, IReadOnlyList<string> collisions)
    {
        output.WriteLine();
        output.WriteLine($"== Curated list: {curated.Products.Count} product(s), not reviewed by a pharmacist");
        foreach (var product in curated.Products)
        {
            output.WriteLine($"  {product.ExternalRef}: {product.Name} | {OfficialCatalogPlanner.FormCode(product.Form)} | {string.Join(" + ", product.SubstanceKeys)}{(product.Presentation is null ? string.Empty : " | " + product.Presentation)}{(product.AliasOfExternalRef is null ? string.Empty : " | alias of " + product.AliasOfExternalRef)}");
        }

        Samples("Name collisions between sources (only the first is written)", collisions);
    }

    public void Lookups(OfficialCatalogPlan plan, IReadOnlyList<string> queries)
    {
        var substances = plan.Substances.ToDictionary(substance => substance.Key, StringComparer.Ordinal);
        foreach (var query in queries)
        {
            var found = plan.Find(query, LookupMax);
            output.WriteLine();
            output.WriteLine($"== Lookup \"{query}\": {found.Count} product(s){(found.Count == LookupMax ? " (first " + LookupMax + ")" : string.Empty)}");
            foreach (var product in found)
            {
                var ingredients = product.SubstanceKeys.Count == 0 ? "(ingredient not listed)" : string.Join(" + ", product.SubstanceKeys.Select(key => $"{substances[key].NamePtBr} ({key})"));
                var registrations = product.RegistrationNumbers.Count == 0 ? "no registration" : $"reg. {string.Join(", ", product.RegistrationNumbers.Take(4))}{(product.RegistrationNumbers.Count > 4 ? ", ..." : string.Empty)}";
                var ambiguous = product.AmbiguousName is null ? string.Empty : $" | AMBIGUOUS name \"{product.AmbiguousName}\"";
                output.WriteLine($"  [{product.Source}] {product.Name} | {OfficialCatalogPlanner.FormCode(product.Form)} | {ingredients} | {registrations}{ambiguous}");
            }
        }
    }

    public void Result(OfficialImportResult result, TimeSpan elapsed)
    {
        output.WriteLine();
        output.WriteLine("== Import");
        Line("substances added", result.SubstancesAdded);
        Line("products added", result.ProductsAdded);
        Line("products updated", result.ProductsUpdated);
        Line("community products adopted", result.ProductsAdopted);
        Line("products unchanged", result.ProductsUnchanged);
        Line("products retired (no longer in their source)", result.ProductsRetired);
        Line("curated aliases merged into their product", result.AliasesMerged);
        Line("products skipped", result.Skipped.Count);
        Samples("Skipped", result.Skipped.Take(20));
        output.WriteLine($"  elapsed: {elapsed.TotalSeconds:N1} s");
    }

    private void Line(string label, int value) => output.WriteLine($"  {label}: {value:N0}");

    private void Samples(string title, IEnumerable<string> lines)
    {
        var list = lines.ToArray();
        if (list.Length == 0)
        {
            return;
        }

        output.WriteLine();
        output.WriteLine($"-- {title}");
        Array.ForEach(list, line => output.WriteLine($"  {line}"));
    }
}
