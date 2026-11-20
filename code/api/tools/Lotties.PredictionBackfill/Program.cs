using Lotties.Infrastructure.Persistence;
using Lotties.PredictionBackfill;
using Microsoft.EntityFrameworkCore;

// One-time backfill tool: walks historical events per baby, replays the prediction engine at each point in time,
// and writes resolved PredictionOutcome rows for predictions that can be compared against the actual next event.
// See docs/design/prediction-accuracy.md (when added) or the task brief for rationale.

BackfillArguments arguments;
try
{
    arguments = BackfillArguments.Parse(args);
}
catch (ArgumentException exception)
{
    Console.Error.WriteLine(exception.Message);
    return 2;
}

if (arguments.Help)
{
    Console.WriteLine(BackfillArguments.Usage);
    return 0;
}

using var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    cancellation.Cancel();
};

try
{
    return await RunAsync(arguments, cancellation.Token);
}
catch (Exception exception) when (exception is IOException or DbUpdateException or Npgsql.NpgsqlException or OperationCanceledException)
{
    Console.Error.WriteLine($"Backfill failed: {exception.GetType().Name}: {exception.Message}");
    var inner = exception.InnerException;
    while (inner is not null)
    {
        Console.Error.WriteLine($"  -> {inner.GetType().Name}: {inner.Message}");
        inner = inner.InnerException;
    }
    return 1;
}

static async Task<int> RunAsync(BackfillArguments arguments, CancellationToken cancellationToken)
{
    var database = DatabaseOptions.FromEnvironment();
    Console.WriteLine($"Connecting to {database.Host}:{database.Port}/{database.Name} ...");
    var options = new DbContextOptionsBuilder<LottiesDbContext>()
        .UseLottiesDatabase(database.ToConnectionString())
        .Options;
    await using var context = new LottiesDbContext((DbContextOptions<LottiesDbContext>)options);
    context.Database.SetCommandTimeout(TimeSpan.FromMinutes(10));

    var service = new PredictionBackfillService(context, Console.Out);
    var result = await service.RunAsync(arguments, cancellationToken);

    Console.WriteLine($"\nCompleted in {result.Elapsed.TotalSeconds:N1} s.");
    Console.WriteLine($"Babies processed: {result.BabiesProcessed}, outcomes created: {result.OutcomesCreated}, skipped (duplicate): {result.OutcomesSkipped}.");
    if (arguments.DryRun)
    {
        Console.WriteLine("Dry run: nothing was written to the database.");
    }

    return 0;
}