namespace Lotties.Domain.Exceptions;

/// <summary>The address lookup service answered, but knows no address for the postal code (the query text is never put in the message).</summary>
public sealed class AddressNotFoundException : DomainException
{
    public AddressNotFoundException()
        : base("address_not_found", "No address was found for that postal code.")
    {
    }
}
