namespace BabyRoutine.Domain.Catalog;

/// <summary>One active ingredient of a <see cref="Product"/>, with its optional strength.</summary>
public sealed class ProductSubstance
{
    private ProductSubstance()
    {
    }

    private ProductSubstance(Guid productId, Guid substanceId, SubstanceStrength? strength)
    {
        ProductId = productId;
        SubstanceId = substanceId;
        Strength = strength;
    }

    public Guid ProductId { get; private set; }

    public Guid SubstanceId { get; private set; }

    public SubstanceStrength? Strength { get; private set; }

    internal static ProductSubstance Create(Guid productId, Guid substanceId, SubstanceStrength? strength) => new(productId, substanceId, strength);

    /// <summary>A product-substance link for seed data (no strength: seeds carry composition names only).</summary>
    public static ProductSubstance Seed(Guid productId, Guid substanceId) => new(productId, substanceId, null);
}

/// <summary>What a new product contains: an existing substance and an optional strength.</summary>
public sealed record ProductIngredient(Guid SubstanceId, SubstanceStrength? Strength);
