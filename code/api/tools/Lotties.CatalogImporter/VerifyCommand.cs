using System.Globalization;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Catalog.Official.Verification;
using Lotties.Infrastructure.Catalog.Official;

namespace Lotties.CatalogImporter;

/// <summary>
/// <c>verify-curated</c>: cross-checks every curated entry against the ANVISA open data files already in the importer's
/// cache directory (no download, no database), writes a Markdown and a JSON report next to them and prints a summary.
/// Exit code 0 = no mismatch and no inconsistency, 1 = mismatch or inconsistency, 2 = usage error, 3 = files missing.
/// </summary>
internal static class VerifyCommand
{
    public const string Name = "verify-curated";

    public const string Usage = """
        Lotties.CatalogImporter verify-curated: cross-checks the curated list against the ANVISA open data (docs/design/26-curated-verification.md).

        Options:
          --cache-dir <dir>          where the importer keeps its downloads (default: <temp>/lotties-anvisa-cache)
          --source <path>            registered-medicines CSV (default: DADOS_ABERTOS_MEDICAMENTOS.csv in the cache dir)
          --forms-source <path>      CMED price list CSV (default: TA_PRECO_MEDICAMENTO.csv in the cache dir)
          --curated <path>           curated list (default: Data/curated-products.json next to the tool)
          --out-dir <dir>            where curated-verification.md and .json are written (default: <cache-dir>/verify-curated)
          --fix-proposals            also print proposed corrections to the curated file (never applied)
          --help                     this text

        Files are never downloaded here. If they are missing, run the importer once to fill the cache:
          dotnet run --project code/api/tools/Lotties.CatalogImporter -- --dry-run
        """;

    public static async Task<int> RunAsync(IReadOnlyList<string> args, TextWriter output, TextWriter error, CancellationToken cancellationToken)
    {
        VerifyArguments arguments;
        try
        {
            arguments = VerifyArguments.Parse(args);
        }
        catch (ArgumentException exception)
        {
            await error.WriteLineAsync(exception.Message);
            return 2;
        }

        if (arguments.Help)
        {
            await output.WriteLineAsync(Usage);
            return 0;
        }

        var missing = new[] { arguments.Source, arguments.FormsSource, arguments.Curated }.Where(path => !File.Exists(path)).ToArray();
        if (missing.Length > 0)
        {
            await error.WriteLineAsync($"Missing file(s): {string.Join(", ", missing)}");
            await error.WriteLineAsync($"The official files are read from the importer's cache ({arguments.CacheDirectory}) and are never downloaded here. Download them with:\n  dotnet run --project code/api/tools/Lotties.CatalogImporter -- --dry-run --cache-dir \"{arguments.CacheDirectory}\"\nthen run verify-curated again.");
            return 3;
        }

        var report = await BuildAsync(arguments, cancellationToken);
        Directory.CreateDirectory(arguments.OutDirectory);
        var entries = CuratedProducts.Parse(await File.ReadAllTextAsync(arguments.Curated, cancellationToken));
        var markdown = Path.Combine(arguments.OutDirectory, "curated-verification.md");
        var json = Path.Combine(arguments.OutDirectory, "curated-verification.json");
        await File.WriteAllTextAsync(markdown, CuratedVerificationReports.ToMarkdown(report, entries), cancellationToken);
        await File.WriteAllTextAsync(json, CuratedVerificationReports.ToJson(report), cancellationToken);

        await output.WriteLineAsync($"Curated list verification ({report.GeneratedOn}), {report.Entries.Count} entries:");
        foreach (var line in CuratedVerificationReports.ConsoleSummary(report))
        {
            await output.WriteLineAsync(line);
        }

        await output.WriteLineAsync($"Reports: {markdown} and {json} (not for the repository).");
        if (arguments.FixProposals)
        {
            foreach (var line in CuratedVerificationReports.FixProposals(report))
            {
                await output.WriteLineAsync(line);
            }
        }

        await output.WriteLineAsync(report.HasFailures ? "FAILED: mismatch or inconsistency found." : "OK: no mismatch and no inconsistency (statuses other than VERIFIED still need a human).");
        return report.HasFailures ? 1 : 0;
    }

    private static async Task<CuratedVerificationReport> BuildAsync(VerifyArguments arguments, CancellationToken cancellationToken)
    {
        var registrations = AnvisaFiles.ReadRegistrationDetails(SourceText.Decode(await File.ReadAllBytesAsync(arguments.Source, cancellationToken)).Text);
        var presentations = AnvisaFiles.ReadPresentationDetails(SourceText.Decode(await File.ReadAllBytesAsync(arguments.FormsSource, cancellationToken)).Text);
        var entries = CuratedProducts.Parse(await File.ReadAllTextAsync(arguments.Curated, cancellationToken));
        var dictionary = CuratedSubstances.Dictionary();
        var verifier = new CuratedVerifier(registrations.Rows, presentations.Rows, dictionary);
        var officialPlan = OfficialCatalogPlanner.Plan(registrations.Rows.Select(row => row.ToRow()).ToArray(), presentations.Rows.Select(row => row.ToRow()).ToArray(), dictionary);
        return CuratedVerificationRunner.Run(entries, verifier, dictionary, officialPlan, DateOnly.FromDateTime(DateTime.UtcNow));
    }
}

/// <summary>Command line of <c>verify-curated</c>.</summary>
internal sealed record VerifyArguments(string CacheDirectory, string Source, string FormsSource, string Curated, string OutDirectory, bool FixProposals, bool Help)
{
    private static readonly HashSet<string> ValueOptions = new(StringComparer.Ordinal) { "--cache-dir", "--source", "--forms-source", "--curated", "--out-dir" };

    public static VerifyArguments Parse(IReadOnlyList<string> args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var flags = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Count; index++)
        {
            var name = args[index];
            if (name is "--fix-proposals" or "--help" or "-h")
            {
                flags.Add(name);
            }
            else if (ValueOptions.Contains(name) && index + 1 < args.Count)
            {
                values[name] = args[++index];
            }
            else
            {
                throw new ArgumentException($"Unknown option or missing value: {name}. Use verify-curated --help.");
            }
        }

        var cache = values.GetValueOrDefault("--cache-dir") ?? Path.Combine(Path.GetTempPath(), "lotties-anvisa-cache");
        return new VerifyArguments(
            cache,
            values.GetValueOrDefault("--source") ?? Path.Combine(cache, Path.GetFileName(new Uri(ImporterArguments.DefaultSource).LocalPath)),
            values.GetValueOrDefault("--forms-source") ?? Path.Combine(cache, Path.GetFileName(new Uri(ImporterArguments.DefaultFormsSource).LocalPath)),
            values.GetValueOrDefault("--curated") ?? Path.Combine(AppContext.BaseDirectory, "Data", "curated-products.json"),
            values.GetValueOrDefault("--out-dir") ?? Path.Combine(cache, "verify-curated"),
            flags.Contains("--fix-proposals"),
            flags.Contains("--help") || flags.Contains("-h"));
    }
}
