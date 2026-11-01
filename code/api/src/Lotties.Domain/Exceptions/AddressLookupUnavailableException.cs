namespace Lotties.Domain.Exceptions;

/// <summary>
/// Every upstream address service failed (timeout, network error, bad answer, error status) or the server is too busy to
/// ask the OpenStreetMap service within its usage policy. The client keeps the manual address field.
/// </summary>
public sealed class AddressLookupUnavailableException : DomainException
{
    private const string Text = "The address lookup is unavailable right now; type the address by hand or try again later.";

    public AddressLookupUnavailableException()
        : base("address_lookup_unavailable", Text)
    {
    }

    public AddressLookupUnavailableException(Exception innerException)
        : base("address_lookup_unavailable", Text, innerException)
    {
    }
}
