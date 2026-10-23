using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Lotties.Domain.Common;

namespace Lotties.Domain.Catalog.Official.Verification;

/// <summary>
/// Runs the whole curated-list verification: every entry against the official data (<see cref="CuratedVerifier"/>), the
/// internal consistency of the list, and the "same active ingredient" suggestions the app would produce for each entry
/// (<see cref="ProductSearch.SameActiveIngredient"/> over products built from the official and curated plans), flagging
/// any pair whose official ingredient sets differ. Pure and deterministic.
/// </summary>
public static partial class CuratedVerificationRunner
{
    private static readonly CountryCode Brazil = CountryCode.From("BR");

    public static CuratedVerificationReport Run(
        IReadOnlyList<CuratedProductEntry> entries,
        CuratedVerifier verifier,
        SubstanceDictionary dictionary,
        OfficialCatalogPlan officialPlan,
        DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(verifier);
        ArgumentNullException.ThrowIfNull(dictionary);
        ArgumentNullException.ThrowIfNull(officialPlan);
        var verifications = entries.Select(verifier.Verify).ToArray();
        var findings = Consistency(entries, verifications, verifier, dictionary);
        var alternatives = Alternatives(entries, verifications, dictionary, officialPlan);
        return new CuratedVerificationReport(today.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), verifications, findings, alternatives);
    }

    /// <summary>The curated entries that can be planned (an id, at least one ingredient, a known form).</summary>
    public static IReadOnlyList<CuratedProductEntry> Plannable(IReadOnlyList<CuratedProductEntry> entries) =>
        entries
            .Where(entry => entry.Ingredients.Any(name => !string.IsNullOrWhiteSpace(name)) && !string.IsNullOrWhiteSpace(entry.Name))
            .Where(entry => entry.Category is null || CuratedCatalogPlanner.Categories.Contains(entry.Category, StringComparer.Ordinal))
            .Where(entry => (CuratedCatalogPlanner.PresentationOf(entry)?.Length ?? 0) <= Product.PresentationMaxLength)
            .Where(entry => entry.AliasOf is null || entries.Any(target => target.Id == entry.AliasOf && target.Id != entry.Id && target.AliasOf is null))
            .DistinctBy(entry => entry.Id, StringComparer.Ordinal)
            .DistinctBy(entry => (ProductNames.Key(entry.Name), entry.Form))
            .ToArray();

    private static List<ConsistencyFinding> Consistency(IReadOnlyList<CuratedProductEntry> entries, IReadOnlyList<EntryVerification> verifications, CuratedVerifier verifier, SubstanceDictionary dictionary)
    {
        var findings = new List<ConsistencyFinding>();
        Duplicates(entries, findings);
        foreach (var entry in entries)
        {
            EntryChecks(entry, verifier, dictionary, findings);
        }

        Equivalence(entries, verifier, dictionary, findings);
        Aliases(entries, findings);
        Categories(entries, verifier, findings);
        RecordedChecks(entries, verifications, findings);
        BasisRegistrations(entries, verifier, findings);
        return findings;
    }

    private static void Duplicates(IReadOnlyList<CuratedProductEntry> entries, List<ConsistencyFinding> findings)
    {
        foreach (var group in entries.GroupBy(entry => entry.Id, StringComparer.Ordinal).Where(group => group.Count() > 1))
        {
            findings.Add(new ConsistencyFinding("DUPLICATE_ID", FindingSeverity.Error, $"The id '{group.Key}' is used {group.Count()} times.", [group.Key]));
        }

        foreach (var group in entries.GroupBy(entry => (ProductNames.Key(entry.Name), entry.Form)).Where(group => group.Count() > 1))
        {
            findings.Add(new ConsistencyFinding("DUPLICATE_NAME", FindingSeverity.Error, $"Name '{group.First().Name}' ({OfficialCatalogPlanner.FormCode(group.Key.Form)}) is listed {group.Count()} times: the importer would write only one.", group.Select(entry => entry.Id).ToArray()));
        }
    }

    private static void EntryChecks(CuratedProductEntry entry, CuratedVerifier verifier, SubstanceDictionary dictionary, List<ConsistencyFinding> findings)
    {
        var names = (entry.Ingredients ?? []).Where(name => !string.IsNullOrWhiteSpace(name)).ToArray();
        if (names.Length == 0)
        {
            findings.Add(new ConsistencyFinding("EMPTY_INGREDIENTS", FindingSeverity.Error, $"'{entry.Id}' lists no ingredient: it would produce no \"same active ingredient\" link and the importer rejects it.", [entry.Id]));
            return;
        }

        foreach (var name in names.Where(name => !dictionary.Resolve(name).Curated))
        {
            findings.Add(new ConsistencyFinding("UNMAPPED_INGREDIENT", FindingSeverity.Warning, $"'{entry.Id}': ingredient '{name}' is not in the curated substance map, so it becomes its own substance and will not match official spellings of the same ingredient.", [entry.Id]));
        }

        var keys = verifier.KeysOf(names);
        foreach (var other in verifier.ByName(entry.Name).Where(product => product.Active))
        {
            if (other.IngredientKeys.Count == 0)
            {
                findings.Add(new ConsistencyFinding("NAME_SHARED_WITH_UNLISTED", FindingSeverity.Warning, $"'{entry.Id}': an active official product is also named '{other.Name}' ({other.Reference}) and lists no ingredient.", [entry.Id]));
            }
            else if (!other.IngredientKeys.SequenceEqual(keys))
            {
                findings.Add(new ConsistencyFinding("NAME_COLLISION", FindingSeverity.Error, $"'{entry.Id}': the name '{entry.Name}' is also an active official product ({other.Reference}) with other ingredients ({string.Join(" + ", other.Ingredients)}). Give the curated entry a distinct name.", [entry.Id]));
            }
        }
    }

    private static void Equivalence(IReadOnlyList<CuratedProductEntry> entries, CuratedVerifier verifier, SubstanceDictionary dictionary, List<ConsistencyFinding> findings)
    {
        var usable = entries.Where(entry => entry.Ingredients.Any(name => !string.IsNullOrWhiteSpace(name))).ToArray();
        var byGenericNames = usable.GroupBy(entry => string.Join("+", entry.Ingredients.Where(name => !string.IsNullOrWhiteSpace(name)).Select(dictionary.Resolve).Select(substance => ActiveIngredientNames.Normalize(substance.NamePtBr)).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)));
        foreach (var group in byGenericNames)
        {
            var keySets = group.Select(entry => string.Join("+", verifier.KeysOf(entry.Ingredients))).Distinct(StringComparer.Ordinal).ToArray();
            if (keySets.Length > 1)
            {
                findings.Add(new ConsistencyFinding("EQUIVALENCE_SPLIT", FindingSeverity.Error, $"The same generic ingredient set ({group.Key}) resolves to different substance keys ({string.Join(" | ", keySets)}): suggestions between these entries would be missed.", group.Select(entry => entry.Id).ToArray()));
            }
        }

        foreach (var group in usable.GroupBy(entry => string.Join("+", verifier.KeysOf(entry.Ingredients))))
        {
            var spellings = group.Select(entry => string.Join("+", entry.Ingredients.Select(ActiveIngredientNames.Normalize).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))).Distinct(StringComparer.Ordinal).ToArray();
            if (spellings.Length > 1)
            {
                findings.Add(new ConsistencyFinding("INGREDIENT_SPELLING_VARIES", FindingSeverity.Warning, $"Entries with the same ingredient set spell it differently ({string.Join(" | ", spellings)}); they still match, but one spelling per ingredient is easier to review.", group.Select(entry => entry.Id).ToArray()));
            }
        }
    }

    /// <summary>An alias must name another entry that is not an alias, with the same ingredient set and form.</summary>
    private static void Aliases(IReadOnlyList<CuratedProductEntry> entries, List<ConsistencyFinding> findings)
    {
        foreach (var entry in entries.Where(entry => entry.AliasOf is not null))
        {
            var target = entries.FirstOrDefault(other => other.Id == entry.AliasOf);
            if (target is null || target.AliasOf is not null || target.Id == entry.Id)
            {
                findings.Add(new ConsistencyFinding("ALIAS_TARGET", FindingSeverity.Error, $"'{entry.Id}' is an alias of '{entry.AliasOf}', which is not another entry that is a product (not an alias itself).", [entry.Id]));
            }
            else if (entry.Form != target.Form || !entry.Ingredients.Select(ActiveIngredientNames.Normalize).Order(StringComparer.Ordinal).SequenceEqual(target.Ingredients.Select(ActiveIngredientNames.Normalize).Order(StringComparer.Ordinal)))
            {
                findings.Add(new ConsistencyFinding("ALIAS_TARGET", FindingSeverity.Error, $"'{entry.Id}' is an alias of '{target.Id}' but has another form or ingredient set.", [entry.Id, target.Id]));
            }
        }
    }

    /// <summary>
    /// A homeopathic product or a food supplement is never an equivalent of a medicine: two entries of different
    /// categories (an entry without a category counts as <c>medicine</c>) must not share an ingredient set, because the
    /// "same active ingredient" suggestions are exact ingredient-set equality.
    /// </summary>
    private static void Categories(IReadOnlyList<CuratedProductEntry> entries, CuratedVerifier verifier, List<ConsistencyFinding> findings)
    {
        foreach (var entry in entries.Where(entry => entry.Category is not null && !CuratedCatalogPlanner.Categories.Contains(entry.Category, StringComparer.Ordinal)))
        {
            findings.Add(new ConsistencyFinding("UNKNOWN_CATEGORY", FindingSeverity.Error, $"'{entry.Id}' has the category '{entry.Category}'; the known ones are {string.Join(", ", CuratedCatalogPlanner.Categories)}.", [entry.Id]));
        }

        var usable = entries.Where(entry => entry.AliasOf is null && entry.Ingredients.Any(name => !string.IsNullOrWhiteSpace(name)));
        foreach (var group in usable.GroupBy(entry => string.Join("+", verifier.KeysOf(entry.Ingredients))))
        {
            var categories = group.Select(entry => entry.Category ?? "medicine").Distinct(StringComparer.Ordinal).ToArray();
            if (categories.Length > 1)
            {
                findings.Add(new ConsistencyFinding("CATEGORY_EQUIVALENCE", FindingSeverity.Error, $"Entries of different categories ({string.Join(", ", categories)}) share the ingredient set {group.Key}: they would be suggested as alternatives to each other.", group.Select(entry => entry.Id).ToArray()));
            }
        }
    }

    private static void RecordedChecks(IReadOnlyList<CuratedProductEntry> entries, IReadOnlyList<EntryVerification> verifications, List<ConsistencyFinding> findings)
    {
        foreach (var (entry, verification) in entries.Zip(verifications))
        {
            var fresh = StatusCode(verification.Status);
            if (entry.AnvisaCheck is { } recorded && !string.Equals(recorded.Status, fresh, StringComparison.OrdinalIgnoreCase))
            {
                var severity = string.Equals(recorded.Status, "VERIFIED", StringComparison.OrdinalIgnoreCase) ? FindingSeverity.Error : FindingSeverity.Warning;
                findings.Add(new ConsistencyFinding("STALE_CHECK", severity, $"'{entry.Id}' records '{recorded.Status}' ({recorded.Date}) but the official data now gives '{fresh}': update or drop the recorded check.", [entry.Id]));
            }

            if (entry.Reviewed && entry.AnvisaCheck is null)
            {
                findings.Add(new ConsistencyFinding("REVIEWED_WITHOUT_CHECK", FindingSeverity.Warning, $"'{entry.Id}' is marked reviewed but has no recorded machine check.", [entry.Id]));
            }
        }
    }

    private static void BasisRegistrations(IReadOnlyList<CuratedProductEntry> entries, CuratedVerifier verifier, List<ConsistencyFinding> findings)
    {
        var byRegistration = verifier.Products.Where(product => product.Registration.Length > 0).ToLookup(product => product.Registration, StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            foreach (var cited in CitedRegistrations(entry.Basis ?? string.Empty))
            {
                var found = byRegistration[cited].FirstOrDefault();
                var message = found is null
                    ? $"'{entry.Id}': the basis cites registration {cited}, which is not in the registered-medicines file (it may be a CMED presentation number or a typo)."
                    : $"'{entry.Id}': the basis cites registration {cited}: officially '{found.Name}', {(found.Active ? "active" : "inactive")}, ingredient {(found.Ingredients.Count == 0 ? "not listed" : string.Join(" + ", found.Ingredients))}.";
                findings.Add(new ConsistencyFinding(found is null ? "BASIS_REGISTRATION_UNKNOWN" : "BASIS_REGISTRATION", FindingSeverity.Warning, message, [entry.Id]));
            }
        }
    }

    private static IEnumerable<string> CitedRegistrations(string basis) =>
        RegistrationText().Matches(basis)
            .Select(match => RegistrationNumbers.Product(match.Value))
            .Where(number => number.Length == RegistrationNumbers.ProductLength)
            .Concat(PresentationText().Matches(basis).Select(match => RegistrationNumbers.OfPresentation(match.Value)).Where(number => number.Length > 0))
            .Distinct(StringComparer.Ordinal);

    private static List<AlternativeCheck> Alternatives(IReadOnlyList<CuratedProductEntry> entries, IReadOnlyList<EntryVerification> verifications, SubstanceDictionary dictionary, OfficialCatalogPlan officialPlan)
    {
        var plannable = Plannable(entries);
        var aliasIds = plannable.Where(entry => entry.AliasOf is not null).Select(entry => entry.Id).ToHashSet(StringComparer.Ordinal);
        if (plannable.Count == 0)
        {
            return [];
        }

        var curated = CuratedCatalogPlanner.Plan(plannable, dictionary);
        var plan = officialPlan.With(curated.Products, curated.Substances);
        var keyById = plan.Products.SelectMany(product => product.SubstanceKeys).Distinct(StringComparer.Ordinal).ToDictionary(SubstanceId, key => key);
        var pool = plan.Products.Where(product => product.AliasOfExternalRef is null).Select(ToProduct).ToArray();
        var officialKeys = verifications.GroupBy(verification => verification.Id, StringComparer.Ordinal).ToDictionary(group => group.Key, group => OfficialKeys(group.First()), StringComparer.Ordinal);
        var curatedProducts = pool.Where(product => product.Source == CuratedCatalogPlanner.CuratedSource).ToDictionary(product => product.ExternalRef!, StringComparer.Ordinal);
        var checks = new List<AlternativeCheck>();
        foreach (var entry in plannable.Where(entry => !aliasIds.Contains(entry.Id)))
        {
            var product = curatedProducts[entry.Id];
            foreach (var sibling in ProductSearch.SameActiveIngredient(product, pool))
            {
                checks.Add(Compare(entry, officialKeys[entry.Id], sibling, officialKeys, keyById));
            }
        }

        return checks;
    }

    private static AlternativeCheck Compare(CuratedProductEntry entry, IReadOnlyList<string>? entryOfficial, Product sibling, IReadOnlyDictionary<string, IReadOnlyList<string>?> officialKeys, IReadOnlyDictionary<Guid, string> keyById)
    {
        var curatedSibling = sibling.Source == CuratedCatalogPlanner.CuratedSource;
        var siblingOfficial = curatedSibling ? officialKeys.GetValueOrDefault(sibling.ExternalRef ?? string.Empty) : null;
        var source = curatedSibling ? "curated" : "official";
        var sameForm = sibling.Form == entry.Form;
        var formNote = sameForm ? string.Empty : $" Form differs: {OfficialCatalogPlanner.FormCode(sibling.Form)} vs {OfficialCatalogPlanner.FormCode(entry.Form)}.";
        if (entryOfficial is null || (curatedSibling && siblingOfficial is null))
        {
            return new AlternativeCheck(entry.Id, sibling.Name, source, AlternativeCheck.Unverified, "The official ingredient set of " + (entryOfficial is null ? "the entry" : "the suggested curated product") + " could not be read from the official data: the suggestion rests on curated data only." + formNote, sameForm);
        }

        // An official sibling's set is the one the official data lists for it; a curated sibling counts through its own official record.
        var other = curatedSibling ? siblingOfficial! : sibling.Substances.Select(substance => keyById[substance.SubstanceId]).Order(StringComparer.Ordinal).ToArray();
        return entryOfficial.SequenceEqual(other)
            ? new AlternativeCheck(entry.Id, sibling.Name, source, AlternativeCheck.Agrees, "Same official ingredient set." + formNote, sameForm)
            : new AlternativeCheck(entry.Id, sibling.Name, source, AlternativeCheck.Differs, $"Official ingredient sets differ: {string.Join("+", entryOfficial)} vs {string.Join("+", other)}." + formNote, sameForm);
    }

    private static IReadOnlyList<string>? OfficialKeys(EntryVerification verification) =>
        verification.Status is VerificationStatus.Verified or VerificationStatus.Mismatch or VerificationStatus.Cancelled
            ? verification.Evidence.FirstOrDefault(product => product.IngredientKeys.Count > 0)?.IngredientKeys
            : null;

    private static Product ToProduct(CatalogProductPlan plan)
    {
        var substanceIds = plan.SubstanceKeys.Select(SubstanceId).ToArray();
        var data = new SourcedProductData(plan.Name, plan.Form, plan.Presentation, plan.Status, plan.Source, plan.ExternalRef, substanceIds, plan.AmbiguousName);
        return Product.FromSource(StableId(plan.Source + "/" + plan.ExternalRef), data, Brazil, DateTimeOffset.UnixEpoch);
    }

    private static Guid SubstanceId(string key) => StableId("substance/" + key);

    private static Guid StableId(string text) => new(MD5.HashData(Encoding.UTF8.GetBytes(text)));

    /// <summary>The upper-case code of a status as written in reports and in the curated file's <c>anvisaCheck</c>.</summary>
    public static string StatusCode(VerificationStatus status) => status switch
    {
        VerificationStatus.NotFound => "NOT_FOUND",
        _ => status.ToString().ToUpperInvariant(),
    };

    [GeneratedRegex(@"\b\d\.\d{4}\.\d{4}\b", RegexOptions.CultureInvariant)]
    private static partial Regex RegistrationText();

    [GeneratedRegex(@"\b\d{13}\b", RegexOptions.CultureInvariant)]
    private static partial Regex PresentationText();
}
