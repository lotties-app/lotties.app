using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Catalog;

/// <summary>
/// What a source record says about one catalog product: display name, form, optional presentation text, the status
/// (<see cref="ProductStatus.Official"/> for ANVISA, <see cref="ProductStatus.Curated"/> for the curated list), the
/// source (<c>anvisa</c>, <c>curated</c>) with the product's stable key in it, the shared name when products with other
/// ingredients use the same name (<see cref="AmbiguousName"/>), and the substances (existing ids, at most
/// <see cref="Product.OfficialMaxSubstances"/>, each once; may be empty when the source lists none). Composition names
/// only: no strength, no dose.
/// </summary>
public sealed record SourcedProductData(
    string Name,
    ProductForm Form,
    string? Presentation,
    ProductStatus Status,
    string Source,
    string ExternalRef,
    IReadOnlyList<Guid> SubstanceIds,
    string? AmbiguousName = null)
{
    /// <summary>The data with the name sanitised and every field checked; throws <see cref="DomainValidationException"/>.</summary>
    public SourcedProductData Validated()
    {
        ArgumentNullException.ThrowIfNull(SubstanceIds);
        EnsureKnownForm();
        EnsureImportedStatus();
        EnsureValidSubstances();
        return this with
        {
            Name = ProductNames.Sanitize(Name, "name", Product.NameMaxLength),
            Presentation = Text.Optional(Presentation, "presentation", Product.PresentationMaxLength),
            Source = Text.Required(Source, "source", Product.SourceMaxLength),
            ExternalRef = Text.Required(ExternalRef, "externalRef", Product.ExternalRefMaxLength),
            AmbiguousName = Text.Optional(AmbiguousName, "ambiguousName", Product.AmbiguousNameMaxLength),
        };
    }

    private void EnsureKnownForm()
    {
        if (!Enum.IsDefined(Form))
        {
            throw new DomainValidationException("form", "form must be one of the catalog forms.");
        }
    }

    private void EnsureImportedStatus()
    {
        if (Status is not (ProductStatus.Official or ProductStatus.Curated))
        {
            throw new DomainValidationException("status", "An imported product is official or curated.");
        }
    }

    private void EnsureValidSubstances()
    {
        if (SubstanceIds.Count > Product.OfficialMaxSubstances || SubstanceIds.Distinct().Count() != SubstanceIds.Count || SubstanceIds.Contains(Guid.Empty))
        {
            throw new DomainValidationException("substances", $"An imported product lists each substance once, at most {Product.OfficialMaxSubstances}.");
        }
    }
}
