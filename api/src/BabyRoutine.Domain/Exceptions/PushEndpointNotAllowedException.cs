namespace BabyRoutine.Domain.Exceptions;

/// <summary>
/// A well-formed push endpoint whose host is not on the allowlist of known browser push services (the SSRF guard).
/// The endpoint itself is a capability URL and is never put in the message.
/// </summary>
public sealed class PushEndpointNotAllowedException : DomainException
{
    public PushEndpointNotAllowedException()
        : base("push_endpoint_not_allowed", "The push endpoint is not a known browser push service.")
    {
    }
}
