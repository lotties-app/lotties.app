using System.Text.RegularExpressions;

namespace Lotties.Domain.Catalog.Official.Verification;

/// <summary>
/// Cross-checks curated entries against the official ANVISA open data (registered medicines and the CMED price list).
/// The match is by registration number when the entry has one, else by exact commercial name (case, accents and spacing
/// ignored). Pure: the caller reads the files. Nothing is inferred: a product without a listed ingredient stays
/// unverifiable, and a similar name is only reported as related, never used as evidence.
/// </summary>
public sealed partial class CuratedVerifier
{
    private const int MaxRelated = 8;
    private const int MaxStrengths = 6;

    private readonly SubstanceDictionary _dictionary;
    private readonly IReadOnlyList<OfficialProductEvidence> _products;
    private readonly ILookup<string, OfficialProductEvidence> _byName;
    private readonly ILookup<string, OfficialProductEvidence> _byRegistration;

    public CuratedVerifier(IReadOnlyList<AnvisaRegistrationDetail> registrations, IReadOnlyList<CmedPresentationDetail> presentations, SubstanceDictionary dictionary)
    {
        ArgumentNullException.ThrowIfNull(registrations);
        ArgumentNullException.ThrowIfNull(presentations);
        _dictionary = dictionary ?? throw new ArgumentNullException(nameof(dictionary));
        var byRegistration = presentations
            .GroupBy(presentation => RegistrationNumbers.OfPresentation(presentation.Registration))
            .Where(group => group.Key.Length > 0)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);
        _products = registrations
            .GroupBy(ProductKey)
            .Select(group => Group(group.ToArray(), byRegistration))
            .DistinctBy(product => (product.Reference, product.Holder, product.Active, string.Join("+", product.IngredientKeys)))
            .ToArray();
        _byName = _products.ToLookup(product => NameKey(product.Name), StringComparer.Ordinal);
        _byRegistration = _products.Where(product => product.Registration.Length > 0).ToLookup(product => product.Registration, StringComparer.Ordinal);
    }

    /// <summary>All official products grouped by registration (or by notified name), for the consistency checks.</summary>
    public IReadOnlyList<OfficialProductEvidence> Products => _products;

    /// <summary>The official products with this exact name (case, accents and spacing ignored).</summary>
    public IEnumerable<OfficialProductEvidence> ByName(string name) => _byName[NameKey(name)];

    public static string NameKey(string name) => ActiveIngredientNames.Normalize(name).Trim();

    /// <summary>The sorted distinct substance keys of ingredient names (curated map first, derived key otherwise).</summary>
    public IReadOnlyList<string> KeysOf(IEnumerable<string> ingredients) =>
        ingredients.Where(name => !string.IsNullOrWhiteSpace(name)).Select(_dictionary.Resolve).Select(substance => substance.Key).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();

    public EntryVerification Verify(CuratedProductEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var keys = KeysOf(entry.Ingredients ?? []);
        var (candidates, label, lookupNotes) = Lookup(entry);
        var notes = new List<string>(lookupNotes);
        if (keys.Count == 0)
        {
            return Result(entry, VerificationStatus.Unverifiable, "The entry lists no ingredient: nothing to compare.", keys, [], candidates, notes);
        }

        if (candidates.Count == 0)
        {
            notes.Add("Not registered or notified under this exact name. It may be exempt from registration (food supplement, probiotic, some saline products), or sold under another name.");
            return Result(entry, VerificationStatus.NotFound, $"No official record named \"{label}\".", keys, [], candidates, notes) with { RelatedOfficialNames = Related(label) };
        }

        var active = candidates.Where(product => product.Active).ToArray();
        return active.Length == 0 ? Inactive(entry, keys, candidates, notes) : Active(entry, keys, active, candidates, notes);
    }

    /// <summary>Administration routes read from the abbreviations of a CMED presentation text (<c>OR</c> oral, <c>NAS</c> nasal...).</summary>
    public static IReadOnlyList<string> Routes(string? presentation)
    {
        var tokens = PharmaceuticalForms.Tokens(presentation);
        var routes = new List<string>();
        AddRoute(routes, tokens, "oral", "OR");
        AddRoute(routes, tokens, "nasal", "NAS", "NASAL");
        AddRoute(routes, tokens, "topical", "DERM", "TOP");
        AddRoute(routes, tokens, "ophthalmic", "OFT");
        AddRoute(routes, tokens, "inhalation", "INAL");
        AddRoute(routes, tokens, "rectal", "SUP", "RET");
        AddRoute(routes, tokens, "buccal", "BUC");
        return routes;
    }

    /// <summary>The leading strength of a CMED presentation text (<c>75 MG/ML</c>), or empty. Information only.</summary>
    public static string Strength(string? presentation) =>
        StrengthPattern().Match((presentation ?? string.Empty).Trim()) is { Success: true } match ? Whitespace().Replace(match.Value, " ").Trim() : string.Empty;

    private static EntryVerification Inactive(CuratedProductEntry entry, IReadOnlyList<string> keys, IReadOnlyList<OfficialProductEvidence> candidates, List<string> notes)
    {
        var listed = candidates.Where(product => product.IngredientKeys.Count > 0).ToArray();
        var differs = listed.Length > 0 && listed.All(product => !product.IngredientKeys.SequenceEqual(keys));
        notes.Add("The official registration is no longer active (cancelled, expired or suspended), so the official import does not offer it.");
        var priced = candidates.Where(product => product.Forms.Count > 0).Select(product => product.Reference).ToArray();
        if (priced.Length > 0)
        {
            notes.Add($"The CMED price list still has presentations for {string.Join(", ", priced)}.");
        }

        notes.Add(listed.Length == 0
            ? "The inactive records list no ingredient."
            : differs ? "The ingredients of the inactive record DIFFER from the entry." : "The ingredients of the inactive record agree with the entry.");
        return differs
            ? Result(entry, VerificationStatus.Mismatch, "Only inactive records exist, and their ingredients differ.", keys, [IngredientDiff(entry, listed[0])], candidates, notes)
            : Result(entry, VerificationStatus.Cancelled, "Only inactive official registrations exist.", keys, [], candidates, notes);
    }

    private static EntryVerification Active(CuratedProductEntry entry, IReadOnlyList<string> keys, OfficialProductEvidence[] active, IReadOnlyList<OfficialProductEvidence> all, List<string> notes)
    {
        InactiveNotes(active, all, notes);
        var sets = active.Select(product => string.Join("+", product.IngredientKeys)).Distinct(StringComparer.Ordinal).ToArray();
        if (sets.Length > 1)
        {
            notes.Add("Several active official products share this name with different ingredient sets: the name alone cannot identify the ingredient.");
            return Result(entry, VerificationStatus.Ambiguous, $"{sets.Length} different ingredient sets under the name.", keys, [], active, notes);
        }

        var official = active[0];
        if (official.IngredientKeys.Count == 0)
        {
            notes.Add("The active official record is a notified (low-risk) product that lists no active ingredient; the entry's ingredient rests only on its basis.");
            return Result(entry, VerificationStatus.Unverifiable, "Active official record without a listed ingredient.", keys, [], active, notes);
        }

        var diffs = official.IngredientKeys.SequenceEqual(keys) ? FormDiffs(entry, active, notes) : [IngredientDiff(entry, official)];

        return diffs.Count == 0
            ? Result(entry, VerificationStatus.Verified, "Active official registration agrees on ingredients, form and route.", keys, [], active, notes)
            : Result(entry, VerificationStatus.Mismatch, "The official data disagrees with the entry.", keys, diffs, active, notes);
    }

    private static void InactiveNotes(OfficialProductEvidence[] active, IReadOnlyList<OfficialProductEvidence> all, List<string> notes)
    {
        var inactive = all.Where(product => !product.Active).ToArray();
        if (inactive.Length == 0)
        {
            return;
        }

        var listed = inactive.Where(product => product.IngredientKeys.Count > 0).ToArray();
        notes.Add(listed.Length == 0
            ? $"{inactive.Length} further inactive record(s) under the same lookup are ignored."
            : $"Inactive record(s) {string.Join(", ", listed.Select(product => product.Reference))} under the same lookup list {string.Join(" | ", listed.Select(product => string.Join(" + ", product.Ingredients)).Distinct(StringComparer.Ordinal))}; they are not used as evidence for the active record{(active.Length > 0 && active.All(product => product.IngredientKeys.Count == 0) ? ", which lists no ingredient" : string.Empty)}.");
    }

    private static List<FieldDiff> FormDiffs(CuratedProductEntry entry, IReadOnlyList<OfficialProductEvidence> active, List<string> notes)
    {
        var diffs = new List<FieldDiff>();
        var forms = active.SelectMany(product => product.Forms).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        var wanted = OfficialCatalogPlanner.FormCode(entry.Form);
        if (forms.Length == 0)
        {
            notes.Add("Form not checked: the CMED price list has no presentation for this registration.");
        }
        else if (!forms.Contains(wanted, StringComparer.Ordinal))
        {
            diffs.Add(new FieldDiff("form", wanted, string.Join(", ", forms)));
        }

        var routes = active.SelectMany(product => product.Routes).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        if (!string.IsNullOrWhiteSpace(entry.Route) && routes.Length > 0 && !routes.Contains(entry.Route.Trim().ToLowerInvariant(), StringComparer.Ordinal))
        {
            diffs.Add(new FieldDiff("route", entry.Route, string.Join(", ", routes)));
        }

        return diffs;
    }

    private static FieldDiff IngredientDiff(CuratedProductEntry entry, OfficialProductEvidence official) =>
        new("ingredients", string.Join(" + ", entry.Ingredients), official.Ingredients.Count == 0 ? "(none listed)" : string.Join(" + ", official.Ingredients));

    private static EntryVerification Result(
        CuratedProductEntry entry,
        VerificationStatus status,
        string summary,
        IReadOnlyList<string> keys,
        IReadOnlyList<FieldDiff> diffs,
        IReadOnlyList<OfficialProductEvidence> evidence,
        IReadOnlyList<string> notes) =>
        WithStrength(new EntryVerification(entry.Id, entry.Name, status, summary, keys, diffs, evidence, notes, []), entry, keys);

    private static EntryVerification WithStrength(EntryVerification verification, CuratedProductEntry entry, IReadOnlyList<string> keys)
    {
        var check = CompareStrength(entry, keys, verification.Evidence);
        return check.Outcome == StrengthOutcome.NotStated
            ? verification with { Strength = check }
            : verification with { Strength = check, Notes = [.. verification.Notes, $"Strength ({check.Outcome}): {check.Detail}"] };
    }

    private (IReadOnlyList<OfficialProductEvidence> Candidates, string Label, List<string> Notes) Lookup(CuratedProductEntry entry)
    {
        var notes = new List<string>();
        var lookupName = string.IsNullOrWhiteSpace(entry.OfficialName) ? entry.Name : entry.OfficialName;
        if (!string.IsNullOrWhiteSpace(entry.Registration))
        {
            var registration = RegistrationNumbers.Product(entry.Registration);
            var found = _byRegistration[registration].ToArray();
            if (found.Length > 0 && found.All(product => NameKey(product.Name) != NameKey(lookupName)))
            {
                notes.Add($"Registration {registration} is named \"{found[0].Name}\" officially, not \"{lookupName}\".");
            }

            return (found, $"registration {registration}", notes);
        }

        if (!string.IsNullOrWhiteSpace(entry.OfficialName))
        {
            notes.Add($"Looked up under the official name \"{entry.OfficialName}\".");
        }

        return (_byName[NameKey(lookupName)].ToArray(), lookupName, notes);
    }

    private IReadOnlyList<string> Related(string name)
    {
        var key = NameKey(name);
        return _products
            .Where(product => product.Active && NameKey(product.Name).StartsWith(key, StringComparison.Ordinal))
            .Select(product => product.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Take(MaxRelated)
            .ToArray();
    }

    private static string ProductKey(AnvisaRegistrationDetail row)
    {
        var registration = RegistrationNumbers.Product(row.RegistrationNumber);
        return registration.Length > 0 ? registration : $"notified:{NameKey(row.ProductName)}:{NameKey(row.Holder)}";
    }

    private OfficialProductEvidence Group(IReadOnlyList<AnvisaRegistrationDetail> rows, Dictionary<string, CmedPresentationDetail[]> presentations)
    {
        var registration = RegistrationNumbers.Product(rows[0].RegistrationNumber);
        var preferred = rows.Any(row => row.IsActive) ? rows.Where(row => row.IsActive).ToArray() : rows.ToArray();
        var ingredients = ActiveIngredientNames.Split(preferred.Select(row => row.ActiveIngredients).FirstOrDefault(field => !string.IsNullOrWhiteSpace(field)));
        var cmed = registration.Length > 0 && presentations.TryGetValue(registration, out var found) ? found : [];
        var readings = ingredients.Count == 1
            ? cmed.Select(presentation => StrengthParser.Read(presentation.Presentation)).ToArray()
            : cmed.Select(_ => StrengthReading.Unknown).ToArray();
        var holder = HolderPrefix().Replace(preferred[0].Holder, string.Empty).Trim();
        return new OfficialProductEvidence(
            preferred[0].ProductName,
            registration,
            rows.Any(row => row.IsActive),
            holder,
            preferred[0].Category,
            ingredients,
            KeysOf(ingredients),
            Distinct(cmed.Select(presentation => OfficialCatalogPlanner.FormCode(PharmaceuticalForms.FromPresentation(presentation.Presentation)))),
            Distinct(cmed.SelectMany(presentation => Routes(presentation.Presentation))),
            Distinct(cmed.Select(presentation => Strength(presentation.Presentation)).Where(strength => strength.Length > 0)).Take(MaxStrengths).ToArray(),
            Distinct(cmed.SelectMany(presentation => ActiveIngredientNames.Split(presentation.Substance.Replace(';', ','))).Select(ActiveIngredientNames.Normalize)),
            readings.Where(reading => reading.IsKnown).Select(reading => reading.Amount!.Token).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray(),
            readings.Count(reading => !reading.IsKnown));
    }

    /// <summary>
    /// Compares the single structured strength an entry states with the CMED strengths of the matched records that have
    /// the same ingredient set. A strength in another unit family is reported as not comparable, never converted; a
    /// combination or a strain has no single amount and is not compared. Pure and information only.
    /// </summary>
    public static StrengthCheck CompareStrength(CuratedProductEntry entry, IReadOnlyList<string> entryKeys, IReadOnlyList<OfficialProductEvidence> evidence)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(entryKeys);
        ArgumentNullException.ThrowIfNull(evidence);
        if (EntryAmount(entry) is not { } stated)
        {
            return new StrengthCheck(StrengthOutcome.NotStated, null, [], "The entry states no single structured strength, so none is compared.");
        }

        var related = evidence.Where(product => product.IngredientKeys.SequenceEqual(entryKeys)).ToArray();
        var tokens = related.SelectMany(product => product.StrengthTokens ?? []).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        var unreadable = related.Sum(product => product.UnreadableStrengths);
        var sameUnit = tokens.Where(token => UnitOf(token) == stated.Unit).ToArray();
        var (outcome, detail) = (tokens.Length, sameUnit.Length, tokens.Contains(stated.Token, StringComparer.Ordinal)) switch
        {
            (_, _, true) => (StrengthOutcome.Agrees, $"CMED lists {stated.Token}{Others(tokens, stated.Token)}."),
            (> 0, > 0, false) => (StrengthOutcome.Differs, $"The entry states {stated.Token} but CMED lists {string.Join(", ", tokens)}."),
            (> 0, 0, false) => (StrengthOutcome.NotComparable, $"CMED lists {string.Join(", ", tokens)}, in another unit than the entry's {stated.Token}: not converted."),
            _ when unreadable > 0 => (StrengthOutcome.NotReadable, $"CMED has {unreadable} presentation(s) whose strength does not read as one unambiguous amount."),
            _ => (StrengthOutcome.NoCmed, "The matched record has no CMED presentation to compare with."),
        };
        var unreadableNote = unreadable > 0 && outcome != StrengthOutcome.NotReadable ? $" {unreadable} other presentation(s) are not readable." : string.Empty;
        return new StrengthCheck(outcome, stated.Token, tokens, detail + unreadableNote);
    }

    private static string Others(string[] tokens, string stated) =>
        tokens.Length > 1 ? $" (and {string.Join(", ", tokens.Where(token => token != stated))})" : string.Empty;

    private static string UnitOf(string token) => token[(token.IndexOf(' ', StringComparison.Ordinal) + 1)..];

    /// <summary>The one numeric strength of a single-ingredient entry, or <c>null</c>.</summary>
    private static StrengthAmount? EntryAmount(CuratedProductEntry entry) =>
        entry.Strengths is { Count: 1 } list && string.IsNullOrWhiteSpace(list[0].Strain) ? StrengthParser.Canonical(list[0].Amount, list[0].Unit) : null;

    private static string[] Distinct(IEnumerable<string> values) => values.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();

    private static void AddRoute(List<string> routes, IReadOnlySet<string> tokens, string route, params string[] markers)
    {
        if (tokens.Overlaps(markers))
        {
            routes.Add(route);
        }
    }

    [GeneratedRegex(@"^\d[\d.,]*\s*(?:%|[A-Za-z]+(?:/[A-Za-z0-9]+)?)(?:\s*\+\s*\d[\d.,]*\s*(?:%|[A-Za-z]+(?:/[A-Za-z0-9]+)?))*", RegexOptions.CultureInvariant)]
    private static partial Regex StrengthPattern();

    [GeneratedRegex(@"^\s*\d{8,14}\s*-\s*", RegexOptions.CultureInvariant)]
    private static partial Regex HolderPrefix();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
