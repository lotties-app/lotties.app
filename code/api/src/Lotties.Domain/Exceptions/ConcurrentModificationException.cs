namespace Lotties.Domain.Exceptions;

/// <summary>
/// Another request changed the same record (e.g. a baby's members) between this request's read and its save, so
/// nothing was saved. Retrying the request (which rereads the current state) is safe.
/// </summary>
public sealed class ConcurrentModificationException : DomainException
{
    public ConcurrentModificationException(string resource, Exception innerException)
        : base("concurrent_modification", $"The {resource} was changed by another request at the same time; nothing was saved. Reload and try again.", innerException)
    {
        Resource = resource;
    }

    /// <summary>What was changed concurrently, e.g. <c>baby</c> or <c>invite</c>.</summary>
    public string Resource { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["resource"] = Resource, ["retryable"] = true };
}
