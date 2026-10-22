using Lotties.Domain.Formulas;

namespace Lotties.Application.Formulas;

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/formulas/{formulaId}</c>: the full editable state. <c>name</c> is required;
/// <c>isCurrent</c> and <c>archived</c> default to <c>false</c>. <c>updatedAt</c> is the client edit time (last write
/// wins, as for events).
/// </summary>
public sealed record UpsertFormulaRequest
{
    public string? Name { get; init; }

    public string? Brand { get; init; }

    public string? Stage { get; init; }

    public string? Notes { get; init; }

    public DateOnly? StartedOn { get; init; }

    public bool IsCurrent { get; init; }

    public bool Archived { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule; throws <see cref="Domain.Exceptions.DomainValidationException"/> naming the field.</summary>
    public static explicit operator FormulaTerms(UpsertFormulaRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return FormulaTerms.Create(request.Name, request.Brand, request.Stage, request.Notes, request.StartedOn, request.IsCurrent, request.Archived);
    }
}

/// <summary>A formula as stored.</summary>
public sealed record FormulaResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public required string Name { get; init; }

    public string? Brand { get; init; }

    public string? Stage { get; init; }

    public string? Notes { get; init; }

    public DateOnly? StartedOn { get; init; }

    public bool IsCurrent { get; init; }

    public bool Archived { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Client edit time of the last applied change; decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public static implicit operator FormulaResponse(Formula formula)
    {
        ArgumentNullException.ThrowIfNull(formula);
        return new FormulaResponse
        {
            Id = formula.Id,
            BabyId = formula.BabyId,
            Name = formula.Name,
            Brand = formula.Brand,
            Stage = formula.Stage,
            Notes = formula.Notes,
            StartedOn = formula.StartedOn,
            IsCurrent = formula.IsCurrent,
            Archived = formula.IsArchived,
            CreatedBy = formula.CreatedBy,
            CreatedAt = formula.CreatedAt,
            UpdatedAt = formula.UpdatedAt,
            ClientUpdatedAt = formula.ClientUpdatedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the formula as stored, and whether this request created it.</summary>
public sealed record UpsertFormulaResult(FormulaResponse Formula, bool Created);
