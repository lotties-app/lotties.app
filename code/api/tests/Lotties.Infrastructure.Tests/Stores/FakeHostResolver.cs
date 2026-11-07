using System.Net;
using Lotties.Application.Stores;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// A scripted resolver: each call returns the next answer (the last one repeats), so a test can change the answer between
/// the check and a reconnect (DNS rebinding). Nothing here touches the network; an unscripted call fails the test.
/// </summary>
internal sealed class FakeHostResolver : IHostResolver
{
    private readonly Queue<Func<CancellationToken, Task<IReadOnlyList<IPAddress>>>> _answers = new();
    private Func<CancellationToken, Task<IReadOnlyList<IPAddress>>>? _last;

    public int Calls { get; private set; }

    public List<string> Names { get; } = [];

    public FakeHostResolver Answer(params string[] addresses)
    {
        IReadOnlyList<IPAddress> parsed = addresses.Select(IPAddress.Parse).ToArray();
        _answers.Enqueue(_ => Task.FromResult(parsed));
        return this;
    }

    public FakeHostResolver Fail(Exception exception)
    {
        _answers.Enqueue(_ => Task.FromException<IReadOnlyList<IPAddress>>(exception));
        return this;
    }

    public FakeHostResolver Hang()
    {
        _answers.Enqueue(async cancellationToken =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return [];
        });
        return this;
    }

    public Task<IReadOnlyList<IPAddress>> ResolveAsync(string hostName, CancellationToken cancellationToken = default)
    {
        Calls++;
        Names.Add(hostName);
        _last = _answers.Count > 0 ? _answers.Dequeue() : _last;
        return _last is null
            ? throw new InvalidOperationException("Tests must not reach the network; script the resolver answer.")
            : _last(cancellationToken);
    }
}
