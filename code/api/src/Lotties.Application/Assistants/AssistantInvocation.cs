namespace Lotties.Application.Assistants;

/// <summary>
/// Who asks an assistant command, as the adapter knows it. The user is the request's authenticated user
/// (<see cref="Users.ICurrentUser"/>: each adapter authenticates her its own way first).
/// </summary>
/// <param name="Adapter">The adapter's stable name (<c>alexa</c>, <c>mcp</c>): part of the written event ids.</param>
/// <param name="RequestId">The adapter's id of this request, the same when the platform retries it: a retry upserts the same event.</param>
/// <param name="FallbackTimeZone">An IANA zone to tell local times in when the user has none stored (e.g. from the request's language); <c>null</c> for none.</param>
public sealed record AssistantInvocation(string Adapter, string RequestId, string? FallbackTimeZone = null)
{
    /// <summary>The longest adapter name or request id accepted.</summary>
    public const int MaxIdLength = 200;

    /// <summary>Throws <see cref="ArgumentException"/> when the adapter name or request id is blank or longer than <see cref="MaxIdLength"/> (an adapter bug).</summary>
    public void EnsureValid()
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(Adapter);
        ArgumentException.ThrowIfNullOrWhiteSpace(RequestId);
        if (Adapter.Length > MaxIdLength || RequestId.Length > MaxIdLength)
        {
            throw new ArgumentException($"The adapter name and the request id must be at most {MaxIdLength} characters.");
        }
    }
}
