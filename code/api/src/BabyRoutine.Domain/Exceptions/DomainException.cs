namespace BabyRoutine.Domain.Exceptions;

/// <summary>Base type for business rule violations. <see cref="Code"/> is a stable machine-readable identifier.</summary>
public abstract class DomainException : Exception
{
    private static readonly IReadOnlyDictionary<string, object?> NoDetails = new Dictionary<string, object?>();

    protected DomainException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    protected DomainException(string code, string message, Exception innerException)
        : base(message, innerException)
    {
        Code = code;
    }

    /// <summary>Stable machine-readable error code, suitable for API error responses.</summary>
    public string Code { get; }

    /// <summary>Extra machine-readable data about the failure (camelCase keys), e.g. the offending items; empty by default.</summary>
    public virtual IReadOnlyDictionary<string, object?> Details => NoDetails;
}
