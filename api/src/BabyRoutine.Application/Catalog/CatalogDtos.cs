using System.Text.Json.Serialization;
using BabyRoutine.Application.Serialization;
using BabyRoutine.Domain.Catalog;

namespace BabyRoutine.Application.Catalog;

/// <summary>A curated substance (generic name in English and Brazilian Portuguese, plus synonyms).</summary>
public sealed record SubstanceResponse
{
    public Guid Id { get; init; }

    public string Key { get; init; } = string.Empty;

    public string NameEn { get; init; } = string.Empty;

    public string NamePtBr { get; init; } = string.Empty;

    public IReadOnlyList<string> Synonyms { get; init; } = [];

    public static implicit operator SubstanceResponse(Substance substance)
    {
        ArgumentNullException.ThrowIfNull(substance);
        return new SubstanceResponse
        {
            Id = substance.Id,
            Key = substance.Key,
            NameEn = substance.NameEn,
            NamePtBr = substance.NamePtBr,
            Synonyms = substance.Synonyms,
        };
    }
}

/// <summary>How much of a substance a product contains, e.g. <c>{"amount":75,"unit":"mg","perAmount":1,"perUnit":"mL"}</c>.</summary>
public sealed record SubstanceStrengthDto
{
    public required decimal Amount { get; init; }

    public required string Unit { get; init; }

    public decimal? PerAmount { get; init; }

    public string? PerUnit { get; init; }

    public static implicit operator SubstanceStrengthDto(SubstanceStrength strength)
    {
        ArgumentNullException.ThrowIfNull(strength);
        return new SubstanceStrengthDto { Amount = strength.Amount, Unit = strength.Unit, PerAmount = strength.PerAmount, PerUnit = strength.PerUnit };
    }

    /// <summary>Validates with the domain rules; throws <see cref="Domain.Exceptions.DomainValidationException"/>.</summary>
    public static explicit operator SubstanceStrength(SubstanceStrengthDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return SubstanceStrength.Create(dto.Amount, dto.Unit, dto.PerAmount, dto.PerUnit);
    }
}

/// <summary>A substance of a product, with its names and optional strength.</summary>
public sealed record ProductSubstanceResponse
{
    public Guid SubstanceId { get; init; }

    public string Key { get; init; } = string.Empty;

    public string NameEn { get; init; } = string.Empty;

    public string NamePtBr { get; init; } = string.Empty;

    public SubstanceStrengthDto? Strength { get; init; }
}

/// <summary>A product of the shared catalog. <see cref="MergedIntoId"/> is set when it was merged into another product.</summary>
public sealed record ProductResponse
{
    public Guid Id { get; init; }

    public string Name { get; init; } = string.Empty;

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProductForm Form { get; init; }

    public string Country { get; init; } = string.Empty;

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProductStatus Status { get; init; }

    public Guid? MergedIntoId { get; init; }

    public IReadOnlyList<ProductSubstanceResponse> Substances { get; init; } = [];

    public DateTimeOffset CreatedAt { get; init; }
}

/// <summary>A short reference to a product (used for the "same active ingredient" siblings).</summary>
public sealed record ProductSummary
{
    public Guid Id { get; init; }

    public string Name { get; init; } = string.Empty;

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProductForm Form { get; init; }

    public string Country { get; init; } = string.Empty;

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProductStatus Status { get; init; }

    public static implicit operator ProductSummary(Product product)
    {
        ArgumentNullException.ThrowIfNull(product);
        return new ProductSummary { Id = product.Id, Name = product.Name, Form = product.Form, Country = product.Country.Value, Status = product.Status };
    }
}

/// <summary>
/// One search result: the product, what matched (<c>name</c>, <c>alias</c> = the name of a product merged into it,
/// <c>substance</c>), the typo distance (0 for equal/prefix/substance matches) and the other products with exactly the
/// same active ingredients (information only; never a substitution advice).
/// </summary>
public sealed record ProductSearchResult
{
    public required ProductResponse Product { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public CatalogMatchKind MatchedBy { get; init; }

    public int Distance { get; init; }

    public IReadOnlyList<ProductSummary> SameActiveIngredient { get; init; } = [];
}

/// <summary>A substance of a new product: an existing substance id and an optional strength.</summary>
public sealed record CreateProductSubstanceRequest
{
    public required Guid SubstanceId { get; init; }

    public SubstanceStrengthDto? Strength { get; init; }

    /// <summary>Validates the strength with the domain rules.</summary>
    public static explicit operator ProductIngredient(CreateProductSubstanceRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return new ProductIngredient(request.SubstanceId, request.Strength is null ? null : (SubstanceStrength)request.Strength);
    }
}

/// <summary>Body of <c>POST /api/v1/catalog/products</c>: a community product.</summary>
public sealed record CreateProductRequest
{
    public string? Name { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProductForm? Form { get; init; }

    public string? Country { get; init; }

    public IReadOnlyList<CreateProductSubstanceRequest>? Substances { get; init; }
}

/// <summary>The product as stored, and whether this request created it (<c>false</c>: an equivalent product already existed).</summary>
public sealed record CreateProductResult(ProductResponse Product, bool Created);
