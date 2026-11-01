using Lotties.Domain.Common;

namespace Lotties.Domain.Assistants;

/// <summary>
/// The id of the event an assistant command writes: a UUID v5 of the adapter, the adapter's request id, the command and
/// the baby, so a request the assistant platform retries (same request id) upserts the same event and never logs twice,
/// while the same words said again (a new request id) log again.
/// </summary>
public static class AssistantEventIds
{
    /// <summary>The UUID v5 namespace of assistant event ids (never change it: replays would duplicate).</summary>
    public static readonly Guid Namespace = new("6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35");

    public static Guid For(string adapter, string requestId, string command, Guid babyId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(adapter);
        ArgumentException.ThrowIfNullOrWhiteSpace(requestId);
        ArgumentException.ThrowIfNullOrWhiteSpace(command);
        return DeterministicGuid.Create(Namespace, $"{adapter}\n{requestId}\n{command}\n{babyId:D}");
    }
}
