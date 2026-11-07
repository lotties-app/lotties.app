using Lotties.Domain.Stores;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// A database endpoint a user typed for their own store was refused by the egress guard (docs/design/47-bring-your-own-database.md
/// section 3.2). The message and details never carry the typed host, a resolved address or the range it fell in: a caller
/// learns that the endpoint is not allowed, never anything about the network behind the API.
/// </summary>
public sealed class StoreEndpointRejectedException : DomainException
{
    private readonly IReadOnlyDictionary<string, object?> _details;

    public StoreEndpointRejectedException(StoreEndpointFailure failure, string? field = null)
        : base(CodeOf(failure), MessageOf(failure))
    {
        Failure = failure;
        _details = field is null ? new Dictionary<string, object?>() : new Dictionary<string, object?> { ["field"] = field };
    }

    public StoreEndpointRejectedException(StoreEndpointFailure failure, Exception innerException)
        : base(CodeOf(failure), MessageOf(failure), innerException)
    {
        Failure = failure;
        _details = new Dictionary<string, object?>();
    }

    /// <summary>Why the endpoint was refused.</summary>
    public StoreEndpointFailure Failure { get; }

    /// <summary>The name of the connection field that was refused (e.g. <c>username</c>), never its value.</summary>
    public override IReadOnlyDictionary<string, object?> Details => _details;

    /// <summary>Stable machine-readable code of a failure (<c>endpoint_*</c>).</summary>
    public static string CodeOf(StoreEndpointFailure failure) => failure switch
    {
        StoreEndpointFailure.InvalidHost => "endpoint_invalid_host",
        StoreEndpointFailure.InvalidField => "endpoint_invalid_field",
        StoreEndpointFailure.PortNotAllowed => "endpoint_port_not_allowed",
        StoreEndpointFailure.BlockedAddress => "endpoint_blocked_address",
        StoreEndpointFailure.Unresolvable => "endpoint_unresolvable",
        StoreEndpointFailure.InvalidCertificate => "endpoint_invalid_ca",
        StoreEndpointFailure.TlsFailed => "endpoint_tls_failed",
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, null),
    };

    private static string MessageOf(StoreEndpointFailure failure) => failure switch
    {
        StoreEndpointFailure.InvalidHost => "The host must be a public database host name, without a scheme, port, path or user.",
        StoreEndpointFailure.InvalidField => "A connection field has characters that are not allowed.",
        StoreEndpointFailure.PortNotAllowed => "This port is not allowed for a database connection.",
        StoreEndpointFailure.BlockedAddress => "This host is not allowed: only public database hosts can be used.",
        StoreEndpointFailure.Unresolvable => "This host could not be found.",
        StoreEndpointFailure.InvalidCertificate => "The CA certificate could not be read.",
        StoreEndpointFailure.TlsFailed => "The database server's certificate could not be verified for this host name.",
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, null),
    };
}
