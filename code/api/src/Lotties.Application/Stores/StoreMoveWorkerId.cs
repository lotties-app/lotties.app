using System.Globalization;
using System.Security.Cryptography;
using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// This process's name as a move worker (a singleton): the lease holder of the moves it starts and runs. Machine, process and a random
/// suffix, at most <see cref="DataStoreMove.HolderMaxLength"/> characters, so a restarted process is another worker.
/// </summary>
public sealed class StoreMoveWorkerId
{
    public StoreMoveWorkerId()
        : this(NewValue())
    {
    }

    public StoreMoveWorkerId(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        Value = value.Length <= DataStoreMove.HolderMaxLength ? value : value[^DataStoreMove.HolderMaxLength..];
    }

    public string Value { get; }

    private static string NewValue()
    {
        var suffix = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
        return string.Create(CultureInfo.InvariantCulture, $"move:{Environment.MachineName}:{Environment.ProcessId}:{suffix}");
    }
}

/// <summary>Hands a just-started move to this process's worker (task T7); the worker's sweep picks up anything a lost hand-off misses.</summary>
public interface IStoreMoveQueue
{
    void Enqueue(Guid babyId);
}
