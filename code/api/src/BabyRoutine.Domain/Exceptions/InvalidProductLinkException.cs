namespace BabyRoutine.Domain.Exceptions;

/// <summary>
/// A baby's medication was linked to a catalog product that does not exist (<c>reason</c> <c>not_found</c>) or was merged
/// into another product (<c>reason</c> <c>merged</c>, <c>mergedIntoId</c> = the product to link instead).
/// </summary>
public sealed class InvalidProductLinkException : DomainException
{
    public const string NotFoundReason = "not_found";
    public const string MergedReason = "merged";

    private InvalidProductLinkException(Guid productId, string reason, Guid? mergedIntoId, string message)
        : base("invalid_product_link", message)
    {
        ProductId = productId;
        Reason = reason;
        MergedIntoId = mergedIntoId;
    }

    public Guid ProductId { get; }

    public string Reason { get; }

    public Guid? MergedIntoId { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?>
    {
        ["productId"] = ProductId,
        ["reason"] = Reason,
        ["mergedIntoId"] = MergedIntoId,
    };

    public static InvalidProductLinkException NotFound(Guid productId) =>
        new(productId, NotFoundReason, null, $"Product {productId} is not in the catalog.");

    public static InvalidProductLinkException Merged(Guid productId, Guid mergedIntoId) =>
        new(productId, MergedReason, mergedIntoId, $"Product {productId} was merged into {mergedIntoId}; link that product instead.");
}
