using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Catalog;

/// <summary>
/// A brand/presentation in the shared, instance-wide catalog (e.g. "Luftal", drops, BR) and the substances it contains.
/// <see cref="NormalizedName"/> is the <see cref="ProductNames.Key"/> of the name; non-merged products are unique by
/// (normalized name, form, country). A merged product (<see cref="MergedIntoId"/> set) is kept as an alias of its
/// target: search matches its name and returns the target. Users can only add <see cref="ProductStatus.Community"/>
/// products; editing, merging and verifying need an admin role that does not exist yet. <see cref="CreatedBy"/> is
/// never exposed.
/// </summary>
public sealed class Product
{
    public const int NameMaxLength = 100;
    public const int MaxSubstances = 10;

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

    public IReadOnlyList<ProductSubstance> Substances => _substances;

    public bool IsMerged => MergedIntoId is not null;

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

    /// <summary>Whether a new product with this key, form and country would duplicate this (non-merged) product.</summary>
    public bool Duplicates(string normalizedName, ProductForm form, CountryCode country) =>
        !IsMerged && NormalizedName == normalizedName && Form == form && Country == country;

    private static void EnsureValidForm(ProductForm form)
    {
        if (!Enum.IsDefined(form))
        {
            throw new DomainValidationException("form", "form must be drops, syrup, tablet, powder or other.");
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
