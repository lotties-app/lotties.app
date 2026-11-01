using System.Text.RegularExpressions;

namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// Pure planning of the official catalog from the ANVISA registered-medicines rows and (optionally) the CMED price list:
/// <list type="number">
/// <item>rows are grouped by registration number; a registration is included only when one of its rows is active
/// (inactive rows never create or revive a product); its ingredients are those of its active rows, else (inheritance)
/// those of another row of the <em>same</em> registration number, else none;</item>
/// <item>active rows without a registration number (notified low-risk products) are included by name, with only the
/// ingredients their own row lists (usually none); nothing is ever guessed from a name or from another product;</item>
/// <item>each included registration yields one entry per catalog form of its CMED presentations
/// (<see cref="PharmaceuticalForms"/>), or one <see cref="ProductForm.Other"/> entry without presentations;</item>
/// <item>names are split and title-cased (<see cref="OfficialNames"/>), ingredients resolved (<see cref="SubstanceDictionary"/>);</item>
/// <item>entries with the same normalized name, ingredient set and form become one product; an "other" fallback is
/// dropped when the same name and ingredients have a real form;</item>
/// <item>a name shared by products with different ingredient sets (e.g. Sorine: naphazoline in a registration, nothing
/// listed in notified products) is never merged: every variant keeps its ingredients, its name carries them
/// (<c>Sorine (cloridrato de nafazolina)</c>, <c>Sorine (princípio ativo não informado)</c>) and it is marked with the
/// shared name (<see cref="CatalogProductPlan.AmbiguousName"/>).</item>
/// </list>
/// </summary>
public static partial class OfficialCatalogPlanner
{
    public const string AnvisaSource = "anvisa";

    /// <summary>Name suffix of a variant of an ambiguous name whose records list no ingredient.</summary>
    public const string NoIngredientSuffix = "princípio ativo não informado";

    private const int SampleSize = 12;
    private const string PresentationSeparator = "; ";

    public static OfficialCatalogPlan Plan(
        IReadOnlyList<AnvisaRegistrationRow> rows,
        IReadOnlyList<CmedPresentationRow> presentations,
        SubstanceDictionary dictionary)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(presentations);
        ArgumentNullException.ThrowIfNull(dictionary);
        var registrations = Registrations(rows, dictionary);
        var forms = FormsByRegistration(presentations);
        var notified = NotifiedRecords(rows, dictionary);
        var included = registrations.Where(registration => registration.Active).ToArray();
        var entries = included.SelectMany(registration => RegisteredEntries(registration, forms)).Concat(notified.SelectMany(NotifiedEntries)).ToArray();
        var groups = Groups(entries);
        var products = Products(groups);
        var substances = SubstancesOf(groups);
        var report = Report(new ReportInput(rows, registrations, included, notified, presentations, forms, entries, groups, products, substances));
        return new OfficialCatalogPlan(products, substances, report);
    }

    /// <summary>The camelCase form name used in <see cref="CatalogProductPlan.ExternalRef"/> (same as the API).</summary>
    public static string FormCode(ProductForm form)
    {
        var name = form.ToString();
        return string.Concat(char.ToLowerInvariant(name[0]).ToString(), name[1..]);
    }

    private static IReadOnlyList<SourceRecord> Registrations(IReadOnlyList<AnvisaRegistrationRow> rows, SubstanceDictionary dictionary) =>
        rows
            .Select(row => (row, number: RegistrationNumbers.Product(row.RegistrationNumber)))
            .Where(entry => entry.number.Length > 0)
            .GroupBy(entry => entry.number, StringComparer.Ordinal)
            .Select(group => SourceRecord.FromRegistration(group.Key, group.Select(entry => entry.row).ToArray(), dictionary))
            .OrderBy(registration => registration.Number, StringComparer.Ordinal)
            .ToArray();

    private static IReadOnlyList<SourceRecord> NotifiedRecords(IReadOnlyList<AnvisaRegistrationRow> rows, SubstanceDictionary dictionary) =>
        rows
            .Where(row => row.IsActive && RegistrationNumbers.Product(row.RegistrationNumber).Length == 0)
            .Select(row => SourceRecord.FromNotified(row, dictionary))
            .ToArray();

    private static IReadOnlyDictionary<string, IReadOnlyList<PresentationForm>> FormsByRegistration(IReadOnlyList<CmedPresentationRow> presentations) =>
        presentations
            .Select(row => (number: RegistrationNumbers.OfPresentation(row.Registration), form: new PresentationForm(PharmaceuticalForms.FromPresentation(row.Presentation), row.Presentation)))
            .Where(entry => entry.number.Length > 0)
            .GroupBy(entry => entry.number, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<PresentationForm>)group.Select(entry => entry.form).ToArray(), StringComparer.Ordinal);

    private static IEnumerable<Entry> RegisteredEntries(SourceRecord registration, IReadOnlyDictionary<string, IReadOnlyList<PresentationForm>> forms)
    {
        var name = OfficialNames.Split(registration.RawName);
        var nameKey = ProductNames.Key(name.DisplayName);
        if (nameKey.Length < ProductNames.MinKeyLength)
        {
            return [];
        }

        return forms.TryGetValue(registration.Number, out var presentationForms)
            ? presentationForms.Select(form => form.Form).Distinct().Select(form => new Entry(registration, name, nameKey, form, FromPresentation: true))
            : [new Entry(registration, name, nameKey, ProductForm.Other, FromPresentation: false)];
    }

    private static IEnumerable<Entry> NotifiedEntries(SourceRecord record)
    {
        var name = OfficialNames.Split(record.RawName);
        var nameKey = ProductNames.Key(name.DisplayName);
        return nameKey.Length < ProductNames.MinKeyLength ? [] : [new Entry(record, name, nameKey, ProductForm.Other, FromPresentation: false)];
    }

    private static IReadOnlyList<Group> Groups(IReadOnlyList<Entry> entries)
    {
        var all = entries
            .GroupBy(entry => (entry.NameKey, entry.Record.Signature, entry.Form))
            .Select(group => Group.From(group.ToArray()))
            .ToArray();
        var withRealForms = all.Where(group => group.HasPresentation).Select(group => (group.NameKey, group.Signature)).ToHashSet();
        var kept = all.Where(group => group.HasPresentation || !withRealForms.Contains((group.NameKey, group.Signature))).ToArray();
        var ambiguous = kept.GroupBy(group => group.NameKey, StringComparer.Ordinal)
            .Where(byName => byName.Select(group => group.Signature).Distinct(StringComparer.Ordinal).Count() > 1)
            .Select(byName => byName.Key)
            .ToHashSet(StringComparer.Ordinal);
        var baseNames = kept.GroupBy(group => group.NameKey, StringComparer.Ordinal)
            .ToDictionary(byName => byName.Key, byName => byName.OrderBy(group => group.FirstRecordOrder, StringComparer.Ordinal).First().BaseName, StringComparer.Ordinal);
        return kept.Select(group => group.Named(baseNames[group.NameKey], ambiguous.Contains(group.NameKey))).ToArray();
    }

    private static IReadOnlyList<CatalogProductPlan> Products(IReadOnlyList<Group> groups)
    {
        var plans = groups.Select(group => group.Plan).OrderBy(plan => plan.NormalizedName, StringComparer.Ordinal).ThenBy(plan => plan.Form).ToArray();
        return plans
            .GroupBy(plan => (plan.NormalizedName, plan.Form))
            .SelectMany(collision => collision.Select((plan, index) => index == 0 ? plan : Renumbered(plan, index + 1)))
            .OrderBy(plan => plan.NormalizedName, StringComparer.Ordinal)
            .ThenBy(plan => plan.Form)
            .ToArray();
    }

    private static CatalogProductPlan Renumbered(CatalogProductPlan plan, int number)
    {
        var suffix = $" {number}";
        var name = Fit(plan.Name, Product.NameMaxLength - suffix.Length) + suffix;
        var key = ProductNames.Key(name);
        return plan with { Name = name, NormalizedName = key, ExternalRef = ExternalRef(key, plan.Form) };
    }

    private static string ExternalRef(string normalizedName, ProductForm form) => $"{normalizedName}:{FormCode(form)}";

    private static string Fit(string value, int maxLength) => value.Length <= maxLength ? value : value[..maxLength].TrimEnd();

    private static IReadOnlyList<SubstanceDefinition> SubstancesOf(IReadOnlyList<Group> groups) =>
        groups
            .SelectMany(group => group.Ingredients)
            .DistinctBy(substance => substance.Key, StringComparer.Ordinal)
            .OrderBy(substance => substance.Key, StringComparer.Ordinal)
            .ToArray();

    private static OfficialCatalogReport Report(ReportInput input) => new()
    {
        SourceRows = input.Rows.Count,
        RowsWithoutRegistration = input.Rows.Count(row => RegistrationNumbers.Product(row.RegistrationNumber).Length == 0),
        ActiveNotifiedRows = input.Notified.Count,
        Registrations = input.Registrations.Count,
        ActiveRegistrations = input.Included.Count,
        ExcludedRegistrations = input.Registrations.Count - input.Included.Count,
        ExcludedPricedRegistrations = input.Registrations.Count(registration => !registration.Active && input.Forms.ContainsKey(registration.Number)),
        InheritedIngredientRegistrations = input.Included.Count(registration => registration.Inherited),
        RegistrationsWithoutIngredients = input.Included.Count(registration => registration.Ingredients.Count == 0),
        RegistrationsWithoutPresentations = input.Included.Count(registration => !input.Forms.ContainsKey(registration.Number)),
        PresentationRows = input.Presentations.Count,
        PresentationsWithoutRegistration = PresentationsWithoutRegistration(input),
        SkippedNames = input.Included.Count + input.Notified.Count - input.Entries.Select(entry => entry.Record).Distinct(ReferenceEqualityComparer.Instance).Count(),
        DroppedFallbacks = input.Entries.GroupBy(entry => (entry.NameKey, entry.Record.Signature, entry.Form)).Count() - input.Groups.Count,
        Products = input.Products.Count,
        ProductsByForm = input.Products.GroupBy(product => product.Form).OrderBy(group => group.Key).ToDictionary(group => group.Key, group => group.Count()),
        Substances = input.Substances.Count,
        CuratedSubstances = input.Substances.Count(substance => substance.Curated),
        AmbiguousNames = input.Products.Select(product => product.AmbiguousName).OfType<string>().Distinct(StringComparer.Ordinal).Count(),
        AmbiguousProducts = input.Products.Count(product => product.AmbiguousName is not null),
        ProductsWithoutIngredients = input.Products.Count(product => product.SubstanceKeys.Count == 0),
        ProductsWithTooManyIngredients = input.Groups.Count(group => group.HasTooManyIngredients),
        NamesWithPresentation = input.Products.Count(product => product.Presentation is not null),
        OtherFormSamples = OtherFormSamples(input.Forms.Values.SelectMany(forms => forms)),
        MultiIngredientSamples = input.Groups.Where(group => group.Ingredients.Count > 1).Take(SampleSize).Select(group => group.Describe()).ToArray(),
        PresentationSplitSamples = input.Groups.Where(group => group.Plan.Presentation is not null).Take(SampleSize).Select(group => $"{group.RawName} -> {group.Plan.Name} | {group.Plan.Presentation}").ToArray(),
        AmbiguousNameSamples = AmbiguousNameSamples(input.Products),
    };

    private static IReadOnlyList<string> AmbiguousNameSamples(IReadOnlyList<CatalogProductPlan> products) =>
        products
            .Where(product => product.AmbiguousName is not null)
            .GroupBy(product => product.AmbiguousName!, StringComparer.Ordinal)
            .Take(SampleSize)
            .Select(group => $"{group.Key}: {string.Join(" | ", group.Select(product => $"{product.Name} ({FormCode(product.Form)})"))}")
            .ToArray();

    private static int PresentationsWithoutRegistration(ReportInput input)
    {
        var included = input.Included.Select(registration => registration.Number).ToHashSet(StringComparer.Ordinal);
        return input.Presentations.Count(row => !included.Contains(RegistrationNumbers.OfPresentation(row.Registration)));
    }

    private static IReadOnlyList<SampleCount> OtherFormSamples(IEnumerable<PresentationForm> forms) =>
        forms
            .Where(form => form.Form == ProductForm.Other)
            .GroupBy(form => FormPattern(form.Presentation), StringComparer.Ordinal)
            .Select(group => new SampleCount(group.Key, group.Count()))
            .OrderByDescending(sample => sample.Count)
            .ThenBy(sample => sample.Text, StringComparer.Ordinal)
            .Take(SampleSize * 2)
            .ToArray();

    private static string FormPattern(string presentation) =>
        string.Join(' ', Strength().Replace(presentation ?? string.Empty, " ").Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(4));

    [GeneratedRegex(@"[\d.,()+/%#]+|\b(?:MG|MCG|ML|G|UI|MEQ|U|L|X|CT|CX)\b", RegexOptions.CultureInvariant)]
    private static partial Regex Strength();

    private sealed record PresentationForm(ProductForm Form, string Presentation);

    /// <summary>A registration (all rows of one number) or one notified row (no number); <see cref="Signature"/> = its sorted substance keys.</summary>
    private sealed record SourceRecord(string Number, string RawName, bool Active, IReadOnlyList<SubstanceDefinition> Ingredients, IReadOnlyList<string> IngredientNames, bool Inherited)
    {
        public string Signature { get; } = string.Join('|', Ingredients.Select(ingredient => ingredient.Key).Order(StringComparer.Ordinal));

        /// <summary>Sort key: registrations by number, notified records after them.</summary>
        public string Order => Number.Length == 0 ? "~" : Number;

        public static SourceRecord FromRegistration(string number, IReadOnlyList<AnvisaRegistrationRow> rows, SubstanceDictionary dictionary)
        {
            var named = rows.FirstOrDefault(row => row.IsActive) ?? rows[0];
            var fromActive = FirstListed(rows.Where(row => row.IsActive));
            var field = fromActive ?? FirstListed(rows) ?? string.Empty;
            var inherited = fromActive is null && field.Length > 0 && rows.Any(row => row.IsActive);
            return Create(number, named.ProductName, rows.Any(row => row.IsActive), field, inherited, dictionary);
        }

        public static SourceRecord FromNotified(AnvisaRegistrationRow row, SubstanceDictionary dictionary) =>
            Create(string.Empty, row.ProductName, row.IsActive, row.ActiveIngredients, false, dictionary);

        private static SourceRecord Create(string number, string rawName, bool active, string field, bool inherited, SubstanceDictionary dictionary)
        {
            var names = ActiveIngredientNames.Split(field);
            var ingredients = names.Select(dictionary.Resolve).DistinctBy(ingredient => ingredient.Key, StringComparer.Ordinal).ToArray();
            return new SourceRecord(number, rawName, active, ingredients, names, inherited);
        }

        private static string? FirstListed(IEnumerable<AnvisaRegistrationRow> rows) =>
            rows.Select(row => row.ActiveIngredients).FirstOrDefault(field => ActiveIngredientNames.Split(field).Count > 0);
    }

    private sealed record Entry(SourceRecord Record, OfficialName Name, string NameKey, ProductForm Form, bool FromPresentation);

    private sealed record Group(
        string NameKey,
        string Signature,
        ProductForm Form,
        bool HasPresentation,
        string FirstRecordOrder,
        string BaseName,
        string RawName,
        string? Presentation,
        IReadOnlyList<SubstanceDefinition> Ingredients,
        IReadOnlyList<string> IngredientNames,
        IReadOnlyList<string> RegistrationNumbers,
        bool HasTooManyIngredients,
        CatalogProductPlan Plan)
    {
        public static Group From(IReadOnlyList<Entry> entries)
        {
            var ordered = entries.OrderBy(entry => entry.Record.Order, StringComparer.Ordinal).ToArray();
            var first = ordered[0];
            var tooMany = first.Record.Ingredients.Count > Product.OfficialMaxSubstances;
            IReadOnlyList<SubstanceDefinition> ingredients = tooMany ? [] : first.Record.Ingredients;
            var numbers = ordered.Select(entry => entry.Record.Number).Where(number => number.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
            var placeholder = new CatalogProductPlan(AnvisaSource, ProductStatus.Official, string.Empty, string.Empty, string.Empty, first.Form, null, [], numbers, null);
            return new Group(
                first.NameKey,
                first.Record.Signature,
                first.Form,
                ordered.Any(entry => entry.FromPresentation),
                first.Record.Order,
                first.Name.DisplayName,
                first.Record.RawName,
                PresentationOf(ordered),
                ingredients,
                first.Record.IngredientNames,
                numbers,
                tooMany,
                placeholder);
        }

        /// <summary>The group with its final name: the shared base name, plus the ingredients when the name is ambiguous.</summary>
        public Group Named(string baseName, bool ambiguous)
        {
            var name = ambiguous ? Fit($"{baseName} ({IngredientSuffix()})", Product.NameMaxLength) : baseName;
            var key = ProductNames.Key(name);
            var plan = Plan with
            {
                ExternalRef = ExternalRef(key, Form),
                Name = name,
                NormalizedName = key,
                Presentation = Presentation,
                SubstanceKeys = Ingredients.Select(ingredient => ingredient.Key).ToArray(),
                AmbiguousName = ambiguous ? Fit(baseName, Product.AmbiguousNameMaxLength) : null,
            };
            return this with { Plan = plan };
        }

        public string Describe() => $"{Plan.Name} ({FormCode(Plan.Form)}): {string.Join(" + ", Ingredients.Select(ingredient => ingredient.NamePtBr))}";

        private string IngredientSuffix()
        {
            var suffix = IngredientNames.Count == 0 ? NoIngredientSuffix : string.Join(", ", IngredientNames);
            var room = Product.NameMaxLength - BaseName.Length - 3;
            return suffix.Length <= room || room < 4 ? suffix : $"{suffix[..(room - 1)].TrimEnd()}…";
        }

        private static string? PresentationOf(IReadOnlyList<Entry> ordered)
        {
            var parts = ordered.Select(entry => entry.Name.Presentation).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var joined = string.Join(PresentationSeparator, parts);
            return joined.Length == 0 ? null : Fit(joined, Product.PresentationMaxLength);
        }
    }

    private sealed record ReportInput(
        IReadOnlyList<AnvisaRegistrationRow> Rows,
        IReadOnlyList<SourceRecord> Registrations,
        IReadOnlyList<SourceRecord> Included,
        IReadOnlyList<SourceRecord> Notified,
        IReadOnlyList<CmedPresentationRow> Presentations,
        IReadOnlyDictionary<string, IReadOnlyList<PresentationForm>> Forms,
        IReadOnlyList<Entry> Entries,
        IReadOnlyList<Group> Groups,
        IReadOnlyList<CatalogProductPlan> Products,
        IReadOnlyList<SubstanceDefinition> Substances);
}
