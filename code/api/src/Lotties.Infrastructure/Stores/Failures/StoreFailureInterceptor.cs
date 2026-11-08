using System.Data.Common;
using Lotties.Domain.Exceptions;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Stores.Failures;

/// <summary>
/// The connection layer of one external store's data contexts (docs/design/47-bring-your-own-database.md section 5, task T8). Every
/// external store adds it to its context options (<see cref="StoreFailureInterceptors.For"/>; see <see cref="IExternalDataStores"/>).
/// A new physical connection is refused at once while the store's breaker is open; a command that ran reports a success; a failed
/// connect, command or transaction step whose error <see cref="StoreFailureClassifier"/> knows is reported to the breaker and replaced
/// by the matching <see cref="StoreFailureException"/> (no inner exception: the driver's text can carry the host, user or address),
/// which the API answers as a retriable 503. Errors without a class (a unique violation, a bad value) pass through unchanged, so the
/// repositories' own handling (lost insert races) stays as it is. A failed save is still one rolled-back transaction: nothing of it
/// is committed.
/// </summary>
public sealed class StoreFailureInterceptor : IDbConnectionInterceptor, IDbCommandInterceptor, IDbTransactionInterceptor
{
    private readonly StoreCircuitBreakers _breakers;
    private readonly ILogger _logger;

    internal StoreFailureInterceptor(Guid storeId, StoreCircuitBreakers breakers, ILogger logger)
    {
        StoreId = storeId;
        _breakers = breakers ?? throw new ArgumentNullException(nameof(breakers));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>The <c>data_stores</c> id of the store whose contexts carry this interceptor.</summary>
    public Guid StoreId { get; }

    public InterceptionResult ConnectionOpening(DbConnection connection, ConnectionEventData eventData, InterceptionResult result)
    {
        _breakers.Check(StoreId);
        return result;
    }

    public ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection, ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
    {
        _breakers.Check(StoreId);
        return ValueTask.FromResult(result);
    }

    public void ConnectionFailed(DbConnection connection, ConnectionErrorEventData eventData) => Translate(eventData.Exception, "connect");

    public Task ConnectionFailedAsync(DbConnection connection, ConnectionErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        Translate(eventData.Exception, "connect");
        return Task.CompletedTask;
    }

    public DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result) => Succeeded(result);

    public ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(Succeeded(result));

    public int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result) => Succeeded(result);

    public ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(Succeeded(result));

    public object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result) => Succeeded(result);

    public ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData eventData, object? result, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(Succeeded(result));

    public void CommandFailed(DbCommand command, CommandErrorEventData eventData) => Translate(eventData.Exception, "command");

    public Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        Translate(eventData.Exception, "command");
        return Task.CompletedTask;
    }

    public void TransactionFailed(DbTransaction transaction, TransactionErrorEventData eventData) => TransactionStepFailed(eventData);

    public Task TransactionFailedAsync(DbTransaction transaction, TransactionErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        TransactionStepFailed(eventData);
        return Task.CompletedTask;
    }

    private T Succeeded<T>(T result)
    {
        _breakers.RecordSuccess(StoreId);
        return result;
    }

    /// <summary>
    /// A failed begin or commit is translated; a failed rollback (it runs while an earlier error unwinds, often on the same dead
    /// connection) is only reported, so it never hides that error.
    /// </summary>
    private void TransactionStepFailed(TransactionErrorEventData eventData)
    {
        if (!eventData.Action.StartsWith("Rollback", StringComparison.Ordinal))
        {
            Translate(eventData.Exception, eventData.Action);
            return;
        }

        if (StoreFailureClassifier.Classify(eventData.Exception) is { } failure)
        {
            _breakers.RecordFailure(StoreId, failure);
        }
    }

    private void Translate(Exception exception, string step)
    {
        if (exception is StoreFailureException || StoreFailureClassifier.Classify(exception) is not { } failure)
        {
            return;
        }

        _logger.LogWarning("Store {StoreId} failed at {Step}: {StoreFailure} ({ErrorType})", StoreId, step, failure, exception.GetType().Name);
        _breakers.RecordFailure(StoreId, failure);
        throw StoreFailureException.Of(failure);
    }
}

/// <summary>Hands out the <see cref="StoreFailureInterceptor"/> of a store (one per store id, sharing the process's breakers).</summary>
internal sealed class StoreFailureInterceptors(StoreCircuitBreakers breakers, ILogger<StoreFailureInterceptor> logger)
{
    public StoreFailureInterceptor For(Guid storeId) => new(storeId, breakers, logger);
}
