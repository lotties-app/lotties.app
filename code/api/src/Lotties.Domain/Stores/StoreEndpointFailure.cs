namespace Lotties.Domain.Stores;

/// <summary>Why the egress guard refused a user's database endpoint (codes in <see cref="Exceptions.StoreEndpointRejectedException.CodeOf"/>).</summary>
public enum StoreEndpointFailure
{
    /// <summary>Not a public host name or canonical IP literal (scheme, path, user info, whitespace, numeric spellings, special-use names).</summary>
    InvalidHost,

    /// <summary>A database, user or password field is empty, too long or has a character that is not allowed.</summary>
    InvalidField,

    /// <summary>The port is not one of the allowed database ports.</summary>
    PortNotAllowed,

    /// <summary>The host is, or resolves to at least one address that is, not globally routable or on the operator's deny list.</summary>
    BlockedAddress,

    /// <summary>The host name did not resolve (no address, resolver failure or timeout).</summary>
    Unresolvable,

    /// <summary>The CA certificate the user pasted could not be parsed or is too large.</summary>
    InvalidCertificate,

    /// <summary>The TLS handshake failed or the server certificate was not valid for the typed host name.</summary>
    TlsFailed,
}
