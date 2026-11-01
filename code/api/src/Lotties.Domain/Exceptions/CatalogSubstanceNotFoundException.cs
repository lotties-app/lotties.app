namespace Lotties.Domain.Exceptions;

/// <summary>A catalog route named a substance that is not in the catalog (404, unlike <see cref="SubstanceNotFoundException"/> in a request body).</summary>
public sealed class CatalogSubstanceNotFoundException : DomainException
{
    public CatalogSubstanceNotFoundException(Guid substanceId)
        : base("substance_not_found", $"Substance {substanceId} is not in the catalog.")
    {
        SubstanceId = substanceId;
    }

    public Guid SubstanceId { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["substanceId"] = SubstanceId };
}
