using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>
/// How the importer writes: products of the sources in <see cref="RetireMissingFrom"/> that the plan no longer has are
/// retired (none for partial runs).
/// </summary>
public sealed record OfficialImportOptions(IReadOnlyCollection<string> RetireMissingFrom)
{
    /// <summary>Retire missing products of both sources (a full run with the curated list).</summary>
    public static OfficialImportOptions Full { get; } = new([OfficialCatalogPlanner.AnvisaSource, CuratedCatalogPlanner.CuratedSource]);

    /// <summary>Retire nothing (partial runs, e.g. <c>--limit</c>).</summary>
    public static OfficialImportOptions Partial { get; } = new([]);
}

/// <summary>What one import wrote.</summary>
public sealed record OfficialImportResult(
    int SubstancesAdded,
    int ProductsAdded,
    int ProductsUpdated,
    int ProductsAdopted,
    int ProductsUnchanged,
    int ProductsRetired,
    IReadOnlyList<string> Skipped);

/// <summary>
/// Writes a plan (official ANVISA products, plus the curated list) to the catalog in one transaction, idempotently:
/// <list type="bullet">
/// <item>substances are matched by key; missing ones are added (<see cref="Substance.FromOfficialList"/>, deterministic id);
/// existing rows, seeded ones included, are never changed;</item>
/// <item>a product is matched by (source, external ref), else by its catalog key (normalized name, form, BR) among
/// non-merged products: a product of the same source is updated in place; a community product is adopted (becomes
/// official/curated, keeps its id and links) only when the planned product lists ingredients, otherwise the planned
/// product is skipped (an ingredient a user entered is never replaced by "not listed"); a product of another source
/// keeps the key and the planned product is skipped. Unmatched products are added with a deterministic id; matched ones
/// are written only when something changed;</item>
/// <item>products of the sources in <see cref="OfficialImportOptions.RetireMissingFrom"/> that the plan no longer contains
/// are retired (<see cref="Product.Retire"/>), never deleted.</item>
/// </list>
/// Products are written in batches; the change tracker is cleared between batches.
/// </summary>
public sealed class OfficialCatalogImporter(LottiesDbContext context, TimeProvider timeProvider, ILogger<OfficialCatalogImporter> logger)
{
    public const string AnvisaSource = OfficialCatalogPlanner.AnvisaSource;
    public const int BatchSize = 500;

    /// <summary>Namespace of the deterministic ids of imported substances and products (RFC 4122 v5).</summary>
    public static readonly Guid IdNamespace = new("dabbd2f7-f991-4d5d-b324-8e0f459a1042");

    private static readonly CountryCode Brazil = CountryCode.From("BR");

    public async Task<OfficialImportResult> ImportAsync(OfficialCatalogPlan plan, OfficialImportOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(options);
        var now = timeProvider.GetUtcNow();
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        var substances = await EnsureSubstancesAsync(plan.Substances, now, cancellationToken);
        var products = await UpsertProductsAsync(plan.Products, substances.Ids, now, cancellationToken);
        var retired = await RetireMissingAsync(plan.Products, options.RetireMissingFrom, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation(
            "Catalog import: {SubstancesAdded} substances added, {ProductsAdded} products added, {ProductsUpdated} updated, {ProductsRetired} retired, {ProductsSkipped} skipped",
            substances.Added,
            products.Added,
            products.Updated,
            retired,
            products.Skipped.Count);
        return new OfficialImportResult(substances.Added, products.Added, products.Updated, products.Adopted, products.Unchanged, retired, products.Skipped);
    }

    /// <summary>The deterministic id of an imported product.</summary>
    public static Guid ProductId(string source, string externalRef) => DeterministicGuid.Create(IdNamespace, $"{source}:product:{externalRef}");

    /// <summary>The deterministic id of an imported substance.</summary>
    public static Guid SubstanceId(string key) => DeterministicGuid.Create(IdNamespace, $"{AnvisaSource}:substance:{key}");

    private async Task<SubstanceWrite> EnsureSubstancesAsync(IReadOnlyList<SubstanceDefinition> definitions, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var existing = await context.Substances.AsNoTracking().ToDictionaryAsync(substance => substance.Key, substance => substance.Id, StringComparer.Ordinal, cancellationToken);
        var added = definitions
            .Where(definition => !existing.ContainsKey(definition.Key))
            .Select(definition => Substance.FromOfficialList(SubstanceId(definition.Key), definition.Key, definition.NameEn, definition.NamePtBr, definition.Synonyms, now))
            .ToArray();
        context.Substances.AddRange(added);
        await context.SaveChangesAsync(cancellationToken);
        context.ChangeTracker.Clear();
        var ids = existing.Concat(added.Select(substance => KeyValuePair.Create(substance.Key, substance.Id))).ToDictionary(StringComparer.Ordinal);
        return new SubstanceWrite(ids, added.Length);
    }

    private async Task<ProductWrite> UpsertProductsAsync(IReadOnlyList<CatalogProductPlan> planned, IReadOnlyDictionary<string, Guid> substanceIds, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var index = await LoadProductIndexAsync(cancellationToken);
        var total = ProductWrite.None;
        foreach (var batch in planned.Chunk(BatchSize))
        {
            cancellationToken.ThrowIfCancellationRequested();
            total = total.Plus(await UpsertBatchAsync(batch, index, substanceIds, now, cancellationToken));
        }

        return total;
    }

    private async Task<ProductWrite> UpsertBatchAsync(
        IReadOnlyList<CatalogProductPlan> batch,
        ProductIndex index,
        IReadOnlyDictionary<string, Guid> substanceIds,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var matchedIds = batch.Select(index.Match).Select(match => match.UpdateId).OfType<Guid>().Distinct().ToList();
        var tracked = await context.Products.Include(product => product.Substances).Where(product => matchedIds.Contains(product.Id)).ToDictionaryAsync(product => product.Id, cancellationToken);
        var outcomes = batch.Select(plan => Upsert(plan, tracked, index, substanceIds, now)).ToArray();
        await context.SaveChangesAsync(cancellationToken);
        context.ChangeTracker.Clear();
        return ProductWrite.From(outcomes);
    }

    /// <summary>Matched again at write time, so a product added earlier in this run (another source) is seen.</summary>
    private UpsertOutcome Upsert(
        CatalogProductPlan plan,
        IReadOnlyDictionary<Guid, Product> tracked,
        ProductIndex index,
        IReadOnlyDictionary<string, Guid> substanceIds,
        DateTimeOffset now)
    {
        var match = index.Match(plan);
        var existing = match.UpdateId is { } id ? tracked.GetValueOrDefault(id) : null;
        var skipReason = match.SkipReason ?? (match.UpdateId is not null && existing is null ? "the name is used by a product added in this run" : null);
        if (skipReason is not null)
        {
            return UpsertOutcome.Skip($"{plan.Source}/{plan.ExternalRef}: {skipReason}");
        }

        try
        {
            var data = new SourcedProductData(plan.Name, plan.Form, plan.Presentation, plan.Status, plan.Source, plan.ExternalRef, plan.SubstanceKeys.Select(key => substanceIds[key]).ToArray(), plan.AmbiguousName);
            return existing is not null ? Update(existing, data) : Add(plan, data, index, now);
        }
        catch (DomainValidationException exception)
        {
            return UpsertOutcome.Skip($"{plan.Source}/{plan.ExternalRef}: {exception.Message}");
        }
    }

    private UpsertOutcome Add(CatalogProductPlan plan, SourcedProductData data, ProductIndex index, DateTimeOffset now)
    {
        var product = Product.FromSource(ProductId(plan.Source, plan.ExternalRef), data, Brazil, now);
        context.Products.Add(product);
        index.Added(product);
        return UpsertOutcome.Of(UpsertKind.Added);
    }

    private static UpsertOutcome Update(Product existing, SourcedProductData data)
    {
        var adopted = existing.Source is null;
        var changed = existing.ApplySource(data);
        return UpsertOutcome.Of(adopted ? UpsertKind.Adopted : changed ? UpsertKind.Updated : UpsertKind.Unchanged);
    }

    private async Task<int> RetireMissingAsync(IReadOnlyList<CatalogProductPlan> planned, IReadOnlyCollection<string> sources, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var kept = planned.Select(plan => (plan.Source, plan.ExternalRef)).ToHashSet();
        var sourceList = sources.ToList();
        if (sourceList.Count == 0)
        {
            return 0;
        }

        var listed = await context.Products.AsNoTracking()
            .Where(product => product.Source != null && sourceList.Contains(product.Source) && product.InactiveSince == null)
            .Select(product => new { product.Id, product.Source, product.ExternalRef })
            .ToListAsync(cancellationToken);
        var missing = listed.Where(product => product.ExternalRef is null || !kept.Contains((product.Source!, product.ExternalRef))).Select(product => product.Id).ToArray();
        foreach (var batch in missing.Chunk(BatchSize))
        {
            await RetireBatchAsync(batch.ToList(), now, cancellationToken);
        }

        return missing.Length;
    }

    private async Task RetireBatchAsync(List<Guid> ids, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var products = await context.Products.Where(product => ids.Contains(product.Id)).ToListAsync(cancellationToken);
        products.ForEach(product => product.Retire(now));
        await context.SaveChangesAsync(cancellationToken);
        context.ChangeTracker.Clear();
    }

    private async Task<ProductIndex> LoadProductIndexAsync(CancellationToken cancellationToken)
    {
        var rows = await context.Products.AsNoTracking()
            .Where(product => product.Country == Brazil && (product.Source != null || product.MergedIntoId == null))
            .Select(product => new ProductKeyRow(product.Id, product.Source, product.ExternalRef, product.NormalizedName, product.Form, product.MergedIntoId))
            .ToListAsync(cancellationToken);
        return ProductIndex.From(rows);
    }

    private sealed record SubstanceWrite(IReadOnlyDictionary<string, Guid> Ids, int Added);

    private sealed record ProductKeyRow(Guid Id, string? Source, string? ExternalRef, string NormalizedName, ProductForm Form, Guid? MergedIntoId);

    /// <summary>How a planned product meets the stored ones: update this id, add it (both null), or skip it.</summary>
    private sealed record ProductMatch(Guid? UpdateId, string? SkipReason)
    {
        public static ProductMatch New { get; } = new(null, null);
    }

    /// <summary>The stored products by (source, external ref) and by catalog key; products added in this run are registered too.</summary>
    private sealed class ProductIndex
    {
        private readonly Dictionary<(string, string), Guid> _byRef;
        private readonly Dictionary<(string, ProductForm), ProductKeyRow> _byKey;

        private ProductIndex(Dictionary<(string, string), Guid> byRef, Dictionary<(string, ProductForm), ProductKeyRow> byKey)
        {
            _byRef = byRef;
            _byKey = byKey;
        }

        public static ProductIndex From(IReadOnlyList<ProductKeyRow> rows) => new(
            rows.Where(row => row.Source is not null && row.ExternalRef is not null).ToDictionary(row => (row.Source!, row.ExternalRef!), row => row.Id),
            rows.Where(row => row.MergedIntoId is null).GroupBy(row => (row.NormalizedName, row.Form)).ToDictionary(group => group.Key, group => group.First()));

        public ProductMatch Match(CatalogProductPlan plan)
        {
            if (_byRef.TryGetValue((plan.Source, plan.ExternalRef), out var id))
            {
                return new ProductMatch(id, null);
            }

            return _byKey.TryGetValue((plan.NormalizedName, plan.Form), out var row) ? KeyMatch(plan, row) : ProductMatch.New;
        }

        public void Added(Product product)
        {
            var row = new ProductKeyRow(product.Id, product.Source, product.ExternalRef, product.NormalizedName, product.Form, null);
            _byRef[(row.Source!, row.ExternalRef!)] = row.Id;
            _byKey[(row.NormalizedName, row.Form)] = row;
        }

        private static ProductMatch KeyMatch(CatalogProductPlan plan, ProductKeyRow row) => row.Source switch
        {
            _ when row.Source == plan.Source => new ProductMatch(row.Id, null),
            null when plan.SubstanceKeys.Count > 0 => new ProductMatch(row.Id, null),
            null => new ProductMatch(null, "the name is used by a community product and this record lists no ingredient"),
            _ => new ProductMatch(null, $"the name is used by a {row.Source} product"),
        };
    }

    private enum UpsertKind
    {
        Added,
        Updated,
        Adopted,
        Unchanged,
        Skipped,
    }

    private sealed record UpsertOutcome(UpsertKind Kind, string? Reason)
    {
        public static UpsertOutcome Of(UpsertKind kind) => new(kind, null);

        public static UpsertOutcome Skip(string reason) => new(UpsertKind.Skipped, reason);
    }

    private sealed record ProductWrite(int Added, int Updated, int Adopted, int Unchanged, IReadOnlyList<string> Skipped)
    {
        public static ProductWrite None { get; } = new(0, 0, 0, 0, []);

        public static ProductWrite From(IReadOnlyList<UpsertOutcome> outcomes) => new(
            outcomes.Count(outcome => outcome.Kind == UpsertKind.Added),
            outcomes.Count(outcome => outcome.Kind == UpsertKind.Updated),
            outcomes.Count(outcome => outcome.Kind == UpsertKind.Adopted),
            outcomes.Count(outcome => outcome.Kind == UpsertKind.Unchanged),
            outcomes.Select(outcome => outcome.Reason).OfType<string>().ToArray());

        public ProductWrite Plus(ProductWrite other) =>
            new(Added + other.Added, Updated + other.Updated, Adopted + other.Adopted, Unchanged + other.Unchanged, [.. Skipped, .. other.Skipped]);
    }
}
