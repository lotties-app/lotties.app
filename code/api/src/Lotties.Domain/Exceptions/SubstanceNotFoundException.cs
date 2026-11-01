namespace Lotties.Domain.Exceptions;

/// <summary>A new catalog product named substances that are not in the curated substance list.</summary>
public sealed class SubstanceNotFoundException : DomainException
{
    public SubstanceNotFoundException(IReadOnlyList<Guid> substanceIds)
        : base("substance_not_found", $"Unknown substances: {string.Join(", ", substanceIds)}. Choose substances from GET /api/v1/catalog/substances.")
    {
        SubstanceIds = substanceIds;
    }

    public IReadOnlyList<Guid> SubstanceIds { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["substanceIds"] = SubstanceIds };
}
