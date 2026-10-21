namespace BabyRoutine.Domain.Exceptions;

/// <summary>No catalog product has the requested id.</summary>
public sealed class ProductNotFoundException : DomainException
{
    public ProductNotFoundException(Guid productId)
        : base("product_not_found", $"Product {productId} is not in the catalog.")
    {
        ProductId = productId;
    }

    public Guid ProductId { get; }
}
