using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Catalog;

/// <summary>
/// A brand/presentation in the shared, instance-wide catalog (e.g. "Luftal", drops, BR) and the substances it contains.
/// <see cref="NormalizedName"/> is the <see cref="ProductNames.Key"/> of the name; non-merged products are unique by
/// (normalized name, form, country). A merged product (<see cref="MergedIntoId"/> set) is kept as an alias of its
/// target: search matches its name and returns the target. Users can only add <see cref="ProductStatus.Community"/>
/// products; editing, merging and verifying need an admin role that does not exist yet. <see cref="CreatedBy"/> is
/// never exposed. <see cref="ProductStatus.Official"/> (ANVISA) and <see cref="ProductStatus.Curated"/> (the curated
/// list) products are written only by the catalog importer (<see cref="Source"/> and <see cref="ExternalRef"/> identify
/// the source record); one that left its source is retired (<see cref="InactiveSince"/>), never deleted, so medications
/// linked to it keep their link. <see cref="AmbiguousName"/> marks products whose source name is shared by products
/// with other ingredients (each variant's name then carries its ingredients).
/// </summary>
public sealed class Product
{
    public const int NameMaxLength = 100;
    public const int MaxSubstances = 10;

    /// <summary>Most ingredients an official product keeps (registered combinations list more than users may enter).</summary>
    public const int OfficialMaxSubstances = 40;
    public const int SourceMaxLength = 32;
    public const int ExternalRefMaxLength = 128;
    public const int PresentationMaxLength = 100;
    public const int AmbiguousNameMaxLength = 100;
    public const int StrengthKeyMaxLength = 512;
    public const int StrengthTextMaxLength = 100;

    private readonly List<ProductSubstance> _substances = [];

    private Product()
    {
    }

    private Product(Guid id, string name, ProductForm form, CountryCode country, ProductStatus status, Guid? createdBy, DateTimeOffset createdAt)
    {
        Id = id;
        Name = name;
        NormalizedName = ProductNames.Key(name);
        Form = form;
        Country = country;
        Status = status;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public ProductForm Form { get; private set; }

    public CountryCode Country { get; private set; }

    public ProductStatus Status { get; private set; }

    public Guid? CreatedBy { get; private set; }

    public Guid? MergedIntoId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>The source of an imported product (<c>anvisa</c> for official, <c>curated</c> for the curated list); <c>null</c> otherwise.</summary>
    public string? Source { get; private set; }

    /// <summary>The product's stable key in <see cref="Source"/> (see <see cref="SourcedProductData.ExternalRef"/>).</summary>
    public string? ExternalRef { get; private set; }

    /// <summary>
    /// The source name shared by products with different ingredients (e.g. <c>Sorine</c>: naphazoline in one registration,
    /// no ingredient listed in another); <c>null</c> when the name is unambiguous. Shown with a warning to check the box.
    /// </summary>
    public string? AmbiguousName { get; private set; }

    /// <summary>Dosage or presentation text the source kept in the name (e.g. <c>0,9%</c>), shown apart from it.</summary>
    public string? Presentation { get; private set; }

    /// <summary>
    /// The canonical structured strength (<see cref="StrengthKeys"/>, e.g. <c>simethicone=75 mg/ml</c>), only when every
    /// ingredient's amount is unambiguous in the source; <c>null</c> = unknown (not imported yet, a combination, several
    /// strengths, a text that could not be read). Information for comparing alternatives, never a dose.
    /// </summary>
    public string? StrengthKey { get; private set; }

    /// <summary>The strength as the source writes it, for display (e.g. <c>75 mg/mL</c> or <c>9 mg/mL (0,9%)</c>); <c>null</c> when unknown.</summary>
    public string? StrengthText { get; private set; }

    /// <summary>When an official product left its source (no longer registered); <c>null</c> while it is listed.</summary>
    public DateTimeOffset? InactiveSince { get; private set; }

    public IReadOnlyList<ProductSubstance> Substances => _substances;

    public bool IsMerged => MergedIntoId is not null;

    /// <summary>Whether search may offer the product: not retired from its official source.</summary>
    public bool IsActive => InactiveSince is null;

    public bool IsOfficial => Status == ProductStatus.Official;

    /// <summary>Order of lists: official products first, then curated ones, then the rest.</summary>
    public int SourceRank => Status switch
    {
        ProductStatus.Official => 0,
        ProductStatus.Curated => 1,
        _ => 2,
    };

    public IReadOnlySet<Guid> SubstanceIds => _substances.Select(substance => substance.SubstanceId).ToHashSet();

    /// <summary>
    /// A product a user adds. The name is sanitised (<see cref="ProductNames.Sanitize"/>); every ingredient must be one
    /// of <paramref name="knownSubstanceIds"/> (else <see cref="SubstanceNotFoundException"/>), listed once, at most
    /// <see cref="MaxSubstances"/>.
    /// </summary>
    public static Product CreateCommunity(
        string name,
        ProductForm form,
        CountryCode country,
        IReadOnlyList<ProductIngredient> ingredients,
        IReadOnlySet<Guid> knownSubstanceIds,
        Guid createdBy,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(ingredients);
        ArgumentNullException.ThrowIfNull(knownSubstanceIds);
        EnsureValidForm(form);
        EnsureValidIngredients(ingredients, knownSubstanceIds);
        var product = new Product(Guid.NewGuid(), ProductNames.Sanitize(name, "name", NameMaxLength), form, country, ProductStatus.Community, Ids.Required(createdBy, nameof(createdBy)), UtcTime.Normalize(now));
        product._substances.AddRange(ingredients.Select(ingredient => ProductSubstance.Create(product.Id, ingredient.SubstanceId, ingredient.Strength)));
        return product;
    }

    /// <summary>A curated product for seed data; its substances are seeded as <see cref="ProductSubstance.Seed"/> rows.</summary>
    public static Product Seed(Guid id, string name, ProductForm form, CountryCode country, DateTimeOffset createdAt) =>
        new(Ids.Required(id, nameof(id)), ProductNames.Sanitize(name, nameof(Name), NameMaxLength), form, country, ProductStatus.Seed, null, UtcTime.Normalize(createdAt));

    /// <summary>
    /// A product written by the catalog importer (official or curated, see <see cref="SourcedProductData.Status"/>), with
    /// the given id (deterministic per source record, so replays create the same rows).
    /// </summary>
    public static Product FromSource(Guid id, SourcedProductData data, CountryCode country, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(data);
        var valid = data.Validated();
        var product = new Product(Ids.Required(id, nameof(id)), valid.Name, valid.Form, country, valid.Status, null, UtcTime.Normalize(now));
        product.ApplySourceFields(valid);
        return product;
    }

    /// <summary>
    /// Brings this product in line with its source record: name, status, presentation, ambiguity, ingredients and the
    /// source keys, and reactivates it when it was retired. A community product with the same key (normalized name,
    /// form, country) is adopted this way, so medications linked to it keep the link. Returns whether anything changed.
    /// The name must keep the product's key and the form must not change.
    /// </summary>
    public bool ApplySource(SourcedProductData data)
    {
        ArgumentNullException.ThrowIfNull(data);
        var valid = data.Validated();
        EnsureSameKey(valid);
        var changed = !IsUpToDateWith(valid);
        Name = valid.Name;
        Status = valid.Status;
        ApplySourceFields(valid);
        return changed;
    }

    /// <summary>Marks an imported product that left its source as inactive (once). Returns whether it changed.</summary>
    public bool Retire(DateTimeOffset now)
    {
        if (!IsActive)
        {
            return false;
        }

        InactiveSince = UtcTime.Normalize(now);
        return true;
    }

    /// <summary>
    /// Turns this product into an alias of <paramref name="target"/> (a duplicate found by an administrator). No endpoint
    /// calls it yet: merging needs an admin role. The target must be another, non-merged product.
    /// </summary>
    public void MergeInto(Product target)
    {
        ArgumentNullException.ThrowIfNull(target);
        if (target.Id == Id || target.IsMerged || IsMerged)
        {
            throw new DomainValidationException("mergedIntoId", "A product can be merged once, into another product that is not merged itself.");
        }

        MergedIntoId = target.Id;
    }

    /// <summary>Whether both products contain exactly the same, non-empty set of substances (strengths ignored).</summary>
    public bool HasSameActiveIngredientsAs(Product other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return _substances.Count > 0 && SubstanceIds.SetEquals(other.SubstanceIds);
    }

    /// <summary>How the structured strengths of this and <paramref name="other"/> compare (unknown when either has none).</summary>
    public StrengthComparison CompareStrengthTo(Product other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return StrengthKeys.Compare(StrengthKey, other.StrengthKey);
    }

    /// <summary>Whether a new product with this key, form and country would duplicate this (non-merged) product.</summary>
    public bool Duplicates(string normalizedName, ProductForm form, CountryCode country) =>
        !IsMerged && NormalizedName == normalizedName && Form == form && Country == country;

    private bool IsUpToDateWith(SourcedProductData data) =>
        Name == data.Name
        && Status == data.Status
        && Source == data.Source
        && ExternalRef == data.ExternalRef
        && Presentation == data.Presentation
        && AmbiguousName == data.AmbiguousName
        && StrengthKey == data.StrengthKey
        && StrengthText == data.StrengthText
        && IsActive
        && _substances.All(link => link.Strength is null)
        && SubstanceIds.SetEquals(data.SubstanceIds);

    private void ApplySourceFields(SourcedProductData data)
    {
        Source = data.Source;
        ExternalRef = data.ExternalRef;
        Presentation = data.Presentation;
        AmbiguousName = data.AmbiguousName;
        StrengthKey = data.StrengthKey;
        StrengthText = data.StrengthText;
        InactiveSince = null;
        ReplaceSubstances(data.SubstanceIds);
    }

    private void ReplaceSubstances(IReadOnlyList<Guid> substanceIds)
    {
        var current = SubstanceIds;
        _substances.RemoveAll(link => !substanceIds.Contains(link.SubstanceId));
        _substances.ForEach(link => link.ClearStrength());
        _substances.AddRange(substanceIds.Where(substanceId => !current.Contains(substanceId)).Select(substanceId => ProductSubstance.Create(Id, substanceId, null)));
    }

    private void EnsureSameKey(SourcedProductData data)
    {
        if (ProductNames.Key(data.Name) != NormalizedName || data.Form != Form || IsMerged)
        {
            throw new DomainValidationException("externalRef", "A source record can only update a non-merged product with the same normalized name and form.");
        }
    }

    private static void EnsureValidForm(ProductForm form)
    {
        if (!Enum.IsDefined(form))
        {
            throw new DomainValidationException("form", "form must be drops, syrup, tablet, powder, spray, ointment, suppository, inhaler or other.");
        }
    }

    private static void EnsureValidIngredients(IReadOnlyList<ProductIngredient> ingredients, IReadOnlySet<Guid> knownSubstanceIds)
    {
        if (ingredients.Count > MaxSubstances || ingredients.DistinctBy(ingredient => ingredient.SubstanceId).Count() != ingredients.Count)
        {
            throw new DomainValidationException("substances", $"substances must list each substance once, at most {MaxSubstances}.");
        }

        var unknown = ingredients.Select(ingredient => ingredient.SubstanceId).Where(id => !knownSubstanceIds.Contains(id)).ToArray();
        if (unknown.Length > 0)
        {
            throw new SubstanceNotFoundException(unknown);
        }
    }
}
