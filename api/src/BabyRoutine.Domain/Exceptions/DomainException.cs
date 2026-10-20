namespace BabyRoutine.Domain.Exceptions;

/// <summary>Base type for business rule violations. <see cref="Code"/> is a stable machine-readable identifier.</summary>
public abstract class DomainException : Exception
{
    protected DomainException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    /// <summary>Stable machine-readable error code, suitable for API error responses.</summary>
    public string Code { get; }
}
