namespace Lotties.Domain.Exceptions;

/// <summary>A medication mapping of an import cannot be applied.</summary>
public sealed class InvalidMedicationMappingException : DomainException
{
    public InvalidMedicationMappingException(string token, string reason)
        : base("import_invalid_medication_mapping", $"Mapping of '{token}' is invalid: {reason}")
    {
        Token = token;
    }

    public string Token { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["token"] = Token };
}
