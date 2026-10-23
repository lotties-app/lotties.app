namespace Lotties.Domain.Exceptions;

/// <summary>The operator turned the address lookup off (<c>AddressLookup:Enabled=false</c>): no third party is ever called.</summary>
public sealed class AddressLookupDisabledException : DomainException
{
    public AddressLookupDisabledException()
        : base("address_lookup_disabled", "The address lookup is turned off on this server.")
    {
    }
}
