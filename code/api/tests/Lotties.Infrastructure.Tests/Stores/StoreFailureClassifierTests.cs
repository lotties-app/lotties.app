using System.Net.Sockets;
using System.Security.Authentication;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// What an exception from a family's store means (docs/design/47-bring-your-own-database.md section 5, task T8), from the shapes
/// Npgsql and EF throw: Postgres errors by SQLSTATE, timeouts, sockets, TLS, a lost connection, and the errors that are not store
/// failures and must pass through untouched.
/// </summary>
public sealed class StoreFailureClassifierTests
{
    public static TheoryData<Exception, StoreFailureClass> Failures => new()
    {
        { Postgres("28P01"), StoreFailureClass.CredentialsRejected },
        { Postgres("53300"), StoreFailureClass.RateLimited },
        { Postgres("53100"), StoreFailureClass.QuotaFull },
        { Postgres("25006"), StoreFailureClass.QuotaFull },
        { Postgres("57014"), StoreFailureClass.Timeout },
        { Postgres("57P01"), StoreFailureClass.Unavailable },
        { Postgres("57P03"), StoreFailureClass.Unavailable },
        { Postgres("42P01"), StoreFailureClass.SchemaConflict },
        { new NpgsqlException("Exception while reading from stream", new TimeoutException()), StoreFailureClass.Timeout },
        { new TimeoutException(), StoreFailureClass.Timeout },
        { new NpgsqlException("Failed to connect", new SocketException((int)SocketError.ConnectionRefused)), StoreFailureClass.PausedOrUnreachable },
        { new SocketException((int)SocketError.HostUnreachable), StoreFailureClass.PausedOrUnreachable },
        { new SocketException((int)SocketError.NetworkUnreachable), StoreFailureClass.PausedOrUnreachable },
        { new SocketException((int)SocketError.HostNotFound), StoreFailureClass.PausedOrUnreachable },
        { new SocketException((int)SocketError.TimedOut), StoreFailureClass.Timeout },
        { new NpgsqlException("reset", new IOException("reset", new SocketException((int)SocketError.ConnectionReset))), StoreFailureClass.Unavailable },
        { new NpgsqlException("Exception while reading from stream", new EndOfStreamException()), StoreFailureClass.Unavailable },
        { new NpgsqlException("The operation is not allowed"), StoreFailureClass.Unavailable },
        { new IOException("broken pipe"), StoreFailureClass.Unavailable },
        { new NpgsqlException("handshake", new AuthenticationException("remote certificate is invalid")), StoreFailureClass.TlsFailed },
        { new StoreEndpointRejectedException(StoreEndpointFailure.TlsFailed), StoreFailureClass.TlsFailed },
        { new StoreEndpointRejectedException(StoreEndpointFailure.Unresolvable), StoreFailureClass.PausedOrUnreachable },
        { new StoreEndpointRejectedException(StoreEndpointFailure.BlockedAddress), StoreFailureClass.Unavailable },
        { new DbUpdateException("save failed", Postgres("53100")), StoreFailureClass.QuotaFull },
        { new InvalidOperationException("transient", new NpgsqlException("x", new TimeoutException())), StoreFailureClass.Timeout },
        { new StoreRateLimitedException(), StoreFailureClass.RateLimited },
    };

    public static TheoryData<Exception?> NotStoreFailures => new()
    {
        null,
        Postgres("23505"),
        Postgres("23503"),
        Postgres("22P02"),
        new DbUpdateException("duplicate", Postgres("23505")),
        new OperationCanceledException(),
        new TaskCanceledException(),
        new InvalidOperationException("a bug"),
        new ArgumentException("a bug", new FormatException()),
    };

    [Theory]
    [MemberData(nameof(Failures))]
    public void Classify_StoreFailure_HasItsClass(Exception exception, StoreFailureClass expected)
    {
        Assert.Equal(expected, StoreFailureClassifier.Classify(exception));
    }

    [Theory]
    [MemberData(nameof(NotStoreFailures))]
    public void Classify_NotAStoreFailure_HasNoClass(Exception? exception)
    {
        Assert.Null(StoreFailureClassifier.Classify(exception));
    }

    private static PostgresException Postgres(string sqlState) =>
        new("message that may name db.example.test and a user", "ERROR", "ERROR", sqlState);
}
