namespace Lotties.Domain.Common;

/// <summary>Argument-shape guards for identifiers.</summary>
internal static class Ids
{
    public static Guid Required(Guid value, string parameterName)
    {
        if (value == Guid.Empty)
        {
            throw new ArgumentException("Identifier must not be empty.", parameterName);
        }

        return value;
    }
}
