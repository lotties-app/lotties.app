using System.Collections.Concurrent;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The connection layer of an external store's data context (docs/design/47-bring-your-own-database.md section 5, task T8) with the
/// production options (<see cref="ExternalStoreSchema"/>) on an Npgsql connection to a closed loopback port (refused at once, no
/// network): the driver's error becomes the class's exception without its text, counts towards the breaker, and once the breaker is
/// open no connection is attempted; nothing logged names the address or the user.
/// </summary>
public sealed class StoreFailureInterceptorTests
{
    private const string User = "lotties_app_who_must_not_be_logged";
    private static readonly Guid StoreId = Guid.Parse("5a000000-0000-4000-8000-0000000000aa");

    private readonly CapturingLoggerProvider _logs = new();

    [Fact]
    public async Task Query_StoreRefusesConnections_ThrowsPausedOrUnreachableUntilTheBreakerAnswersAlone()
    {
        using var loggers = LoggerFactory.Create(builder => builder.AddProvider(_logs).SetMinimumLevel(LogLevel.Trace));
        var breakers = new StoreCircuitBreakers(Options.Create(new StoreCircuitBreakerOptions()), TimeProvider.System, loggers.CreateLogger<StoreCircuitBreakers>(), () => 0);
        var interceptor = new StoreFailureInterceptors(breakers, loggers.CreateLogger<StoreFailureInterceptor>()).For(StoreId);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            await using var context = Context(interceptor, loggers);
            var error = await Assert.ThrowsAsync<StorePausedOrUnreachableException>(() => context.Events.CountAsync());
            Assert.Null(error.InnerException);
        }

        await using var rejectedContext = Context(interceptor, loggers);
        var rejected = await Assert.ThrowsAsync<StorePausedOrUnreachableException>(() => rejectedContext.Events.CountAsync());

        Assert.Equal(StoreCircuitPhase.Open, breakers.PhaseOf(StoreId));
        Assert.NotNull(rejected.RetryAfter);
        Assert.Equal(StoreId, interceptor.StoreId);
        Assert.Equal(3, _logs.Messages.Count(message => message.Contains("failed at connect", StringComparison.Ordinal)));
        Assert.DoesNotContain(_logs.Messages, message => message.Contains("127.0.0.1", StringComparison.Ordinal) || message.Contains(User, StringComparison.Ordinal));
    }

    private static LottiesDataDbContext Context(StoreFailureInterceptor interceptor, ILoggerFactory loggers)
    {
        var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder
        {
            Host = "127.0.0.1",
            Port = 1,
            Database = "lotties",
            Username = User,
            Password = "not-a-secret",
            Timeout = 5,
            Pooling = false,
        }.ConnectionString);
        return new LottiesDataDbContext(new DbContextOptionsBuilder<LottiesDataDbContext>(ExternalStoreSchema.Options(connection))
            .UseLoggerFactory(loggers)
            .AddInterceptors(interceptor)
            .Options);
    }

    /// <summary>Keeps every formatted log message and the text of any exception logged with it.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public ConcurrentQueue<string> Messages { get; } = new();

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(Messages);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                messages.Enqueue($"{formatter(state, exception)} {exception}");
        }
    }
}
