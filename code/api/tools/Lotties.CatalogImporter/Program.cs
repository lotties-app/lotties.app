using System.Diagnostics;
using Lotties.CatalogImporter;
using Lotties.Domain.Catalog.Official;
using Lotties.Infrastructure.Catalog.Official;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Admin tool: imports ANVISA's registered medicines into the shared catalog. Run from a machine that can reach the
// database, never from the API pod; see docs/design/13-anvisa-catalog.md and docs/DEPLOY.md.
ImporterArguments arguments;
try
{
    arguments = ImporterArguments.Parse(args);
}
catch (ArgumentException exception)
{
    Console.Error.WriteLine(exception.Message);
    return 2;
}

if (arguments.Help)
{
    Console.WriteLine(ImporterArguments.Usage);
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
catch (Exception exception) when (exception is IOException or HttpRequestException or UnauthorizedAccessException or Lotties.Domain.Exceptions.DomainException or DbUpdateException or Npgsql.NpgsqlException or OperationCanceledException)
{
    Console.Error.WriteLine($"Import failed: {exception.GetType().Name}: {exception.Message}");
    return 1;
}

static async Task<int> RunAsync(ImporterArguments arguments, CancellationToken cancellationToken)
{
    var printer = new ReportPrinter(Console.Out);
    using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
    var files = new SourceFiles(http, arguments.CacheDirectory, arguments.Refresh, Console.Out);
    var watch = Stopwatch.StartNew();

    var registrationFile = await files.ResolveAsync(arguments.Source, cancellationToken);
    var registrationText = SourceText.Decode(await File.ReadAllBytesAsync(registrationFile.Path, cancellationToken));
    var registrations = AnvisaFiles.ReadRegistrations(registrationText.Text, arguments.Limit);
    var (presentations, presentationText) = await ReadPresentationsAsync(files, arguments.FormsSource, cancellationToken);
    printer.Sources(registrations, registrationText, presentations, presentationText);

    var dictionary = CuratedSubstances.Dictionary();
    var official = OfficialCatalogPlanner.Plan(registrations.Rows, presentations?.Rows ?? [], dictionary);
    var curated = arguments.CuratedSource is null
        ? new CuratedCatalogPlan([], [])
        : CuratedCatalogPlanner.Plan(CuratedProducts.Parse(await File.ReadAllTextAsync(arguments.CuratedSource, cancellationToken)), dictionary);
    var plan = official.With(curated.Products, curated.Substances);
    printer.Plan(official);
    printer.Curated(curated, plan.KeyCollisions());
    printer.Lookups(plan, arguments.Lookups);
    Console.WriteLine($"\nPlanned in {watch.Elapsed.TotalSeconds:N1} s.");
    if (arguments.DryRun)
    {
        Console.WriteLine("Dry run: no database connection, nothing written.");
        return 0;
    }

    var database = arguments.UseMigrator ? DatabaseOptions.ForMigratorFromEnvironment() : DatabaseOptions.FromEnvironment();
    Console.WriteLine($"Writing to {database.Host}:{database.Port}/{database.Name} with the {(arguments.UseMigrator ? "migrator" : "app")} role{(arguments.Limit is null ? string.Empty : " (--limit: products missing from this partial plan are not retired)")}{(arguments.CuratedSource is null ? " (--curated none: curated products are not retired)" : string.Empty)} ...");
    var options = new DbContextOptionsBuilder<LottiesDbContext>().UseLottiesDatabase(database.ToConnectionString()).Options;
    await using var context = new LottiesDbContext((DbContextOptions<LottiesDbContext>)options);
    context.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
    var importer = new OfficialCatalogImporter(context, TimeProvider.System, NullLogger<OfficialCatalogImporter>.Instance);
    watch.Restart();
    var importOptions = arguments.Limit is not null ? OfficialImportOptions.Partial
        : arguments.CuratedSource is null ? new OfficialImportOptions([OfficialCatalogPlanner.AnvisaSource])
        : OfficialImportOptions.Full;
    var result = await importer.ImportAsync(plan, importOptions, cancellationToken);
    printer.Result(result, watch.Elapsed);
    return 0;
}

static async Task<(SourceRows<CmedPresentationRow>? Rows, DecodedSource? Text)> ReadPresentationsAsync(SourceFiles files, string? source, CancellationToken cancellationToken)
{
    if (source is null)
    {
        return (null, null);
    }

    var file = await files.ResolveAsync(source, cancellationToken);
    var text = SourceText.Decode(await File.ReadAllBytesAsync(file.Path, cancellationToken));
    return (AnvisaFiles.ReadPresentations(text.Text), text);
}
