using System.Net.Sockets;
using System.Security.Authentication;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Npgsql;

namespace Lotties.Infrastructure.Stores.Failures;

/// <summary>
/// Tells what an exception from a family's store means (docs/design/47-bring-your-own-database.md section 5, task T8): a Postgres error
/// by its SQLSTATE (<see cref="StoreSqlStates"/>), a timeout, a refused or unreachable socket, a failed TLS handshake, a lost connection.
/// Reads types and codes only, never the message (the driver's text can carry a host, a user or an address). An error that is not a
/// failure of the store (a unique violation, a bad value, a cancelled request) has no class and is left to the code that handles it.
/// </summary>
public static class StoreFailureClassifier
{
    /// <summary>The class of <paramref name="exception"/>, or <c>null</c> when it is not a failure of the store.</summary>
    public static StoreFailureClass? Classify(Exception? exception) => exception switch
    {
        null or OperationCanceledException => null,
        StoreFailureException failure => failure.Failure,
        StoreEndpointRejectedException rejected => OfEndpoint(rejected.Failure),
        PostgresException postgres => StoreSqlStates.Classify(postgres.SqlState),
        AuthenticationException => StoreFailureClass.TlsFailed,
        TimeoutException => StoreFailureClass.Timeout,
        SocketException socket => OfSocket(socket.SocketErrorCode),
        NpgsqlException or IOException => Classify(exception.InnerException) ?? StoreFailureClass.Unavailable,
        _ => Classify(exception.InnerException),
    };

    private static StoreFailureClass OfEndpoint(StoreEndpointFailure failure) => failure switch
    {
        StoreEndpointFailure.TlsFailed or StoreEndpointFailure.InvalidCertificate => StoreFailureClass.TlsFailed,
        StoreEndpointFailure.Unresolvable => StoreFailureClass.PausedOrUnreachable,
        _ => StoreFailureClass.Unavailable,
    };

    private static StoreFailureClass OfSocket(SocketError error) => error switch
    {
        SocketError.TimedOut => StoreFailureClass.Timeout,
        SocketError.ConnectionReset or SocketError.ConnectionAborted or SocketError.Shutdown or SocketError.NotConnected => StoreFailureClass.Unavailable,
        _ => StoreFailureClass.PausedOrUnreachable,
    };
}
