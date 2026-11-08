using System.Net;
using System.Net.Sockets;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// A postgres:17 container of its own that the failure tests pause, stop and start (design 47 task T8). Its host port is fixed when it
/// is created, so the address the stores were given stays the same across a stop and a start, as a user's database host would.
/// </summary>
public sealed class StoppablePostgresFixture : PostgresFixture
{
    private readonly int _hostPort = FreeLoopbackPort();

    /// <summary>Freezes every process of the container: connections are accepted by the kernel and never answered.</summary>
    public Task PauseAsync() => Container.PauseAsync();

    public Task UnpauseAsync() => Container.UnpauseAsync();

    /// <summary>Stops the database: nothing listens on its port until <see cref="StartAsync"/>.</summary>
    public Task StopAsync() => Container.StopAsync();

    /// <summary>Starts the stopped database again on the same port and forgets the connections of the old server.</summary>
    public async Task StartAsync()
    {
        await Container.StartAsync();
        NpgsqlConnection.ClearAllPools();
        await WaitUntilAcceptingAsync();
    }

    /// <summary>Waits (up to a minute) until the restarted server accepts a connection.</summary>
    private async Task WaitUntilAcceptingAsync()
    {
        var deadline = DateTimeOffset.UtcNow.AddMinutes(1);
        while (true)
        {
            try
            {
                await using var connection = new NpgsqlConnection(ConnectionString);
                await connection.OpenAsync();
                return;
            }
            catch (NpgsqlException) when (DateTimeOffset.UtcNow < deadline)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(250));
            }
        }
    }

    protected override PostgreSqlBuilder Configure(PostgreSqlBuilder builder) =>
        builder.WithPortBinding(_hostPort, PostgreSqlBuilder.PostgreSqlPort);

    private static int FreeLoopbackPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}

/// <summary>The collection of the tests that pause and stop their database: one container, never shared with the other suites.</summary>
[CollectionDefinition(Name)]
public sealed class StoppablePostgresCollection : ICollectionFixture<StoppablePostgresFixture>
{
    public const string Name = "Postgres failures";
}
