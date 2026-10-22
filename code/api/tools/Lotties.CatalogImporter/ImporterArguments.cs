using System.Globalization;

namespace Lotties.CatalogImporter;

/// <summary>Command line of the importer (see <see cref="Usage"/>).</summary>
internal sealed record ImporterArguments(
    string Source,
    string? FormsSource,
    string? CuratedSource,
    string CacheDirectory,
    bool Refresh,
    bool DryRun,
    int? Limit,
    IReadOnlyList<string> Lookups,
    bool UseMigrator,
    bool Help)
{
    public const string DefaultSource = "https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv";
    public const string DefaultFormsSource = "https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv";

    public const string Usage = """
        Lotties.CatalogImporter: imports ANVISA's registered medicines into the shared catalog (docs/design/13-anvisa-catalog.md).

        Options:
          --source <url|path>        registered-medicines CSV (default: DADOS_ABERTOS_MEDICAMENTOS.csv on dados.anvisa.gov.br)
          --forms-source <url|path>  CMED price list CSV, used for the pharmaceutical form (default: TA_PRECO_MEDICAMENTO.csv);
                                     "none" skips it (every product is then "other")
          --curated <path>           curated product list (default: Data/curated-products.json next to the tool); "none" skips it
          --cache-dir <dir>          where downloads are kept (default: <temp>/lotties-anvisa-cache); never inside the repository
          --refresh                  download again even when the cache has the file
          --dry-run                  plan and print counts, samples and mapping decisions; no database connection, writes nothing
          --limit <n>                read only the first n registration rows (retiring is skipped)
          --lookup <a,b,...>         print what the plan has for these names or ingredients (spot check)
          --use-migrator             connect with DB_MIGRATOR_USER/DB_MIGRATOR_PASSWORD instead of DB_APP_USER/DB_APP_PASSWORD
          --help                     this text

        Database (not used by --dry-run): DB_HOST, DB_PORT, DB_NAME and DB_APP_USER/DB_APP_PASSWORD (or the migrator pair),
        the same variables as the API. Credentials are never printed.
        """;

    public static ImporterArguments Parse(IReadOnlyList<string> args)
    {
        ArgumentNullException.ThrowIfNull(args);
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var flags = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Count; index++)
        {
            index = ReadOption(args, index, values, flags);
        }

        return new ImporterArguments(
            values.GetValueOrDefault("--source") ?? DefaultSource,
            ParseFormsSource(values.GetValueOrDefault("--forms-source")),
            ParseCurated(values.GetValueOrDefault("--curated")),
            values.GetValueOrDefault("--cache-dir") ?? Path.Combine(Path.GetTempPath(), "lotties-anvisa-cache"),
            flags.Contains("--refresh"),
            flags.Contains("--dry-run"),
            ParseLimit(values.GetValueOrDefault("--limit")),
            (values.GetValueOrDefault("--lookup") ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            flags.Contains("--use-migrator"),
            flags.Contains("--help") || flags.Contains("-h"));
    }

    private static readonly HashSet<string> ValueOptions = new(StringComparer.Ordinal) { "--source", "--forms-source", "--curated", "--cache-dir", "--limit", "--lookup" };
    private static readonly HashSet<string> FlagOptions = new(StringComparer.Ordinal) { "--refresh", "--dry-run", "--use-migrator", "--help", "-h" };

    private static int ReadOption(IReadOnlyList<string> args, int index, Dictionary<string, string> values, HashSet<string> flags)
    {
        var name = args[index];
        if (FlagOptions.Contains(name))
        {
            flags.Add(name);
            return index;
        }

        if (!ValueOptions.Contains(name) || index + 1 >= args.Count)
        {
            throw new ArgumentException($"Unknown option or missing value: {name}. Use --help.");
        }

        values[name] = args[index + 1];
        return index + 1;
    }

    private static string? ParseFormsSource(string? value) =>
        string.Equals(value, "none", StringComparison.OrdinalIgnoreCase) ? null : value ?? DefaultFormsSource;

    private static string? ParseCurated(string? value) =>
        string.Equals(value, "none", StringComparison.OrdinalIgnoreCase) ? null : value ?? Path.Combine(AppContext.BaseDirectory, "Data", "curated-products.json");

    private static int? ParseLimit(string? value) => value switch
    {
        null => null,
        _ when int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var limit) && limit > 0 => limit,
        _ => throw new ArgumentException("--limit must be a positive whole number."),
    };
}
