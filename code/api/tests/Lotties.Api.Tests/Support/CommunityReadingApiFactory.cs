using System.Collections.Concurrent;
using System.Data.Common;
using System.Text.RegularExpressions;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.CommunityInsights;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Repositories;
using Lotties.Infrastructure.Stores.Moves;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// The API for the community event loading tests (docs/design/34-community-insights.md section 5.3): the job's reading switch, cap key
/// and population limit come from <see cref="Reading"/> (read again in every DI scope, so a test turns reading on between two runs), every
/// SQL command of both contexts is kept in <see cref="Sql"/>, every log line in <see cref="Logs"/>, and the event source records the
/// babies it was asked to read (<see cref="Source"/>; it can also be told to fail).
/// </summary>
public sealed class CommunityReadingApiFactory : ApiFactory
{
    public CommunityReadingSettings Reading { get; } = new();

    internal RecordedSql Sql { get; } = new();

    internal CapturingLogs Logs { get; } = new();

    internal RecordedEventReads Source { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            // The app's own background services (push planning, demo cleanup, ...) would run queries of their own and blur what
            // one run of the job queried; the tests call the runner directly.
            foreach (var hosted in services.Where(IsAppHostedService).ToArray())
            {
                services.Remove(hosted);
            }

            services.PostConfigure<CommunityAggregationOptions>(options =>
            {
                options.ReadEvents = Reading.ReadEvents;
                options.CapKey = Reading.CapKey;
                options.MaxBabiesPerRun = Reading.MaxBabiesPerRun;
            });
            services.ConfigureDbContext<LottiesDbContext>(options => options.AddInterceptors(Sql));
            services.ConfigureDbContext<LottiesDataDbContext>(options => options.AddInterceptors(Sql));
            services.AddSingleton<ILoggerProvider>(Logs);
            services.AddScoped<EfCommunityEventSource>();
            services.Replace(ServiceDescriptor.Scoped<ICommunityEventSource>(provider => new RecordingEventSource(provider.GetRequiredService<EfCommunityEventSource>(), Source)));
        });
    }

    private static bool IsAppHostedService(ServiceDescriptor descriptor) =>
        descriptor.ServiceType == typeof(IHostedService)
        && descriptor.ImplementationType?.Namespace?.StartsWith("Lotties.", StringComparison.Ordinal) == true;
}

/// <summary>What the job's options say in the next scope.</summary>
public sealed class CommunityReadingSettings
{
    public bool ReadEvents { get; set; }

    public string? CapKey { get; set; }

    public int MaxBabiesPerRun { get; set; }
}

/// <summary>The babies the event source was asked to read, and whether its next reads fail.</summary>
internal sealed class RecordedEventReads
{
    private readonly ConcurrentQueue<Guid> _read = new();

    public IReadOnlyList<Guid> Read => [.. _read];

    public bool Fail { get; set; }

    public void Clear() => _read.Clear();

    public void Add(Guid babyId) => _read.Enqueue(babyId);
}

internal sealed class RecordingEventSource(ICommunityEventSource inner, RecordedEventReads recorded) : ICommunityEventSource
{
    public Task<IReadOnlyList<CommunitySubject>> SubjectsAsync(IReadOnlyList<Guid> eligibleBabyIds, string textVersion, CancellationToken cancellationToken = default) =>
        inner.SubjectsAsync(eligibleBabyIds, textVersion, cancellationToken);

    public Task<CommunityEventRows?> ReadAsync(Guid babyId, DateTimeOffset startedFrom, DateTimeOffset startedBefore, CancellationToken cancellationToken = default)
    {
        recorded.Add(babyId);
        return recorded.Fail
            ? throw new InvalidOperationException($"Test failure while reading baby {babyId}.")
            : inner.ReadAsync(babyId, startedFrom, startedBefore, cancellationToken);
    }
}

/// <summary>Every SQL command run through the contexts it intercepts, and the ones that touch a data-plane table.</summary>
internal sealed class RecordedSql : DbCommandInterceptor
{
    private static readonly Regex DataPlaneTable = new(
        $"""(FROM|JOIN|INTO|UPDATE)\s+"?({string.Join('|', DataPlaneTables.InCopyOrder.Select(table => table.Name))})"?(\s|$|;)""",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private readonly ConcurrentQueue<string> _commands = new();

    public IReadOnlyList<string> All => [.. _commands];

    /// <summary>The commands that read or write events or any other data-plane table (<see cref="DataPlaneTables"/>).</summary>
    public IReadOnlyList<string> DataPlane => [.. _commands.Where(command => DataPlaneTable.IsMatch(command))];

    public void Clear() => _commands.Clear();

    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        _commands.Enqueue(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        _commands.Enqueue(command.CommandText);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
    {
        _commands.Enqueue(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
    {
        _commands.Enqueue(command.CommandText);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        _commands.Enqueue(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        _commands.Enqueue(command.CommandText);
        return ValueTask.FromResult(result);
    }
}
