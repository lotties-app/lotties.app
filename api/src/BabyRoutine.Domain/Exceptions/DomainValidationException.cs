namespace BabyRoutine.Domain.Exceptions;

/// <summary>A value supplied to the domain does not satisfy its rules.</summary>
public sealed class DomainValidationException : DomainException
{
    public DomainValidationException(string field, string message)
        : base("validation_failed", message)
    {
        Field = field;
    }

    /// <summary>Name of the offending field.</summary>
    public string Field { get; }
}
