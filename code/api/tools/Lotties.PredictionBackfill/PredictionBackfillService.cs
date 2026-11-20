using System.Diagnostics;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Lotties.PredictionBackfill;

/// <summary>Arguments parsed from the command line for the prediction backfill tool.</summary>
internal sealed record BackfillArguments(bool DryRun, Guid? BabyId, int UtcOffsetMinutes, bool Help)
{
    public const string Usage = """
        Usage: Lotties.PredictionBackfill [options]

        Options:
          --dry-run                Log what would be created without writing to the database.
          --baby-id <id>           Backfill a single baby (GUID) instead of all babies.
          --utc-offset-minutes <n> UTC offset in minutes for the family's timezone (e.g. -180 for São Paulo).
                                   Required so age bands and day phases are computed in local time.
          --help                   Show this help message.

        Environment variables (same as the API):
          DB_HOST, DB_PORT, DB_NAME, DB_APP_USER, DB_APP_PASSWORD
        """;

    public static BackfillArguments Parse(string[] args)
    {
        var dryRun = false;
        Guid? babyId = null;
        int? utcOffsetMinutes = null;
        var help = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--dry-run":
                    dryRun = true;
                    break;
                case "--baby-id" when i + 1 < args.Length:
                    if (!Guid.TryParse(args[++i], out var id))
                    {
                        throw new ArgumentException($"Invalid baby id: '{args[i]}'.");
                    }
                    babyId = id;
                    break;
                case "--utc-offset-minutes" when i + 1 < args.Length:
                    if (!int.TryParse(args[++i], out var offset))
                    {
                        throw new ArgumentException($"Invalid UTC offset: '{args[i]}'. Must be an integer (e.g. -180).");
                    }
                    utcOffsetMinutes = offset;
                    break;
                case "--help":
                case "-h":
                    help = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown argument: '{args[i]}'. Use --help for usage.");
            }
        }

        if (!help && !utcOffsetMinutes.HasValue)
        {
            throw new ArgumentException("--utc-offset-minutes is required. Use --help for usage.");
        }

        return new BackfillArguments(dryRun, babyId, utcOffsetMinutes ?? 0, help);
    }
}

/// <summary>Summary of a completed backfill run.</summary>
internal sealed record BackfillResult(TimeSpan Elapsed, int BabiesProcessed, int OutcomesCreated, int OutcomesSkipped);

/// <summary>
/// Walks every baby's historical events chronologically, replays <see cref="PredictionEngine.Predict"/> at each event
/// boundary, and writes resolved <see cref="PredictionOutcome"/> rows for predictions whose actual next event is known.
/// Idempotent: skips outcomes that already exist for the same (BabyId, TypeKey, PredictedAt).
/// </summary>
internal sealed class PredictionBackfillService(LottiesDbContext context, TextWriter output)
{
    private static readonly PredictionOptions Options = PredictionOptions.Default with { AccuracyTrackingEnabled = true };

    public async Task<BackfillResult> RunAsync(BackfillArguments arguments, CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        var babies = await LoadBabiesAsync(arguments.BabyId, cancellationToken);
        if (babies.Count == 0)
        {
            await output.WriteLineAsync("No babies found.");
            return new BackfillResult(watch.Elapsed, 0, 0, 0);
        }

        // Pre-load existing outcome keys so we can skip duplicates without hitting the database per prediction.
        var existingKeys = await LoadExistingOutcomeKeysAsync(cancellationToken);

        var totalCreated = 0;
        var totalSkipped = 0;
        var processed = 0;

        foreach (var baby in babies)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (created, skipped) = await BackfillBabyAsync(baby, existingKeys, arguments.DryRun, arguments.UtcOffsetMinutes, cancellationToken);
            totalCreated += created;
            totalSkipped += skipped;
            processed++;
            await output.WriteLineAsync($"  [{processed}/{babies.Count}] {baby.Id}: {created} created, {skipped} skipped.");
        }

        return new BackfillResult(watch.Elapsed, processed, totalCreated, totalSkipped);
    }

    private async Task<IReadOnlyList<Baby>> LoadBabiesAsync(Guid? babyId, CancellationToken cancellationToken)
    {
        var query = context.Babies.AsNoTracking();
        if (babyId is not null)
        {
            query = query.Where(b => b.Id == babyId.Value);
        }

        return await query.OrderBy(b => b.Id).ToListAsync(cancellationToken);
    }

    /// <summary>Loads the set of (BabyId, TypeKey, PredictedAtUtc) tuples that already have an outcome row.</summary>
    private async Task<HashSet<(Guid BabyId, string TypeKey, long PredictedAtTicks)>> LoadExistingOutcomeKeysAsync(
        CancellationToken cancellationToken)
    {
        var rows = await context.PredictionOutcomes
            .AsNoTracking()
            .Select(e => new { e.BabyId, e.TypeKey, e.PredictedAt })
            .ToListAsync(cancellationToken);

        var keys = new HashSet<(Guid, string, long)>();
        foreach (var row in rows)
        {
            keys.Add((row.BabyId, row.TypeKey, row.PredictedAt.UtcTicks));
        }

        return keys;
    }

    private async Task<(int Created, int Skipped)> BackfillBabyAsync(
        Baby baby,
        HashSet<(Guid BabyId, string TypeKey, long PredictedAtTicks)> existingKeys,
        bool dryRun,
        int utcOffsetMinutes,
        CancellationToken cancellationToken)
    {
        // Load all non-deleted events for this baby, ordered chronologically. The global query filter on
        // LottiesDbContext.Events excludes soft-deleted rows, which is what the prediction engine expects.
        // We load events without joining EventTypes (EF Core can't translate the join + Key.Value ordering),
        // then resolve type keys in a separate lookup.
        var rawEvents = await context.Events
            .AsNoTracking()
            .Where(e => e.BabyId == baby.Id)
            .OrderBy(e => e.StartedAt)
            .Select(e => new { e.TypeId, e.StartedAt, e.EndedAt, e.Payload })
            .ToListAsync(cancellationToken);

        if (rawEvents.Count == 0)
        {
            return (0, 0);
        }

        // Resolve TypeId → EventTypeKey in bulk to avoid N+1 queries.
        var typeIds = rawEvents.Select(e => e.TypeId).Distinct().ToList();
        var typeKeyMap = await context.EventTypes.AsNoTracking()
            .Where(t => typeIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.Key.Value, cancellationToken);

        var observed = rawEvents
            .Select(e => ToObserved(EventTypeKey.From(typeKeyMap.GetValueOrDefault(e.TypeId, "unknown")), e.StartedAt, e.EndedAt, e.Payload))
            .ToArray();
        var created = 0;
        var skipped = 0;
        var pendingBatch = new List<PredictionOutcomeEntity>();

        // Walk through each event boundary. At each point, the "known history" is everything up to and including
        // the current event. We predict from that snapshot and look for the next event of the same type afterwards.
        for (var i = 0; i < observed.Length; i++)
        {
            var historySlice = observed[..(i + 1)];
            // Apply the family's UTC offset so PredictionContext.LocalOffset matches what the live API uses.
            // Without this, Npgsql returns timestamptz as UTC (offset zero), causing AgeBands.At and DayPhases.Of
            // to compute in UTC instead of local time, which shifts dates across age-band boundaries and produces
            // null AgeBand/Phase in outcomes. We use a separate localNow for the context only; the original
            // observed[i].StartedAt (UTC) is used for all database writes since Npgsql rejects non-UTC offsets.
            var utcNow = observed[i].StartedAt;
            var localNow = utcNow.ToOffset(TimeSpan.FromMinutes(utcOffsetMinutes));
            var predictionContext = new PredictionContext(baby.BirthDate, localNow);
            var predictionSet = PredictionEngine.Predict(historySlice, predictionContext, Options);

            foreach (var prediction in predictionSet.Predictions)
            {
                // Find the next event of the same type strictly after this prediction point.
                var actualNext = FindNextEventOfType(observed, i + 1, prediction.TypeKey);
                if (actualNext is null)
                {
                    continue;
                }

                var predictedAtTicks = utcNow.UtcTicks;
                var key = (baby.Id, prediction.TypeKey.Value, predictedAtTicks);
                if (existingKeys.Contains(key))
                {
                    skipped++;
                    continue;
                }

                var actualNextStart = actualNext.StartedAt;
                var errorMinutes = Math.Abs((actualNextStart - prediction.NextStart.Expected).TotalMinutes);

                if (!dryRun)
                {
                    // Use the engine's own AgeBand and Phase from the prediction reason rather than
                    // recomputing independently. This ensures the outcome records exactly what the
                    // engine decided, avoiding divergence caused by timezone or rounding differences.
                    var ageBand = prediction.Reason.AgeBand;
                    var phase = prediction.Reason.Phase;

                    pendingBatch.Add(new PredictionOutcomeEntity
                    {
                        Id = Guid.NewGuid(),
                        BabyId = baby.Id,
                        TypeKey = prediction.TypeKey.Value,
                        PredictedAt = utcNow,
                        AnchorAt = prediction.AnchorAt,
                        ExpectedNextStart = prediction.NextStart.Expected,
                        ActualNextStart = actualNextStart,
                        ErrorMinutes = errorMinutes,
                        EngineVersion = PredictionEngine.Version,
                        SampleCount = prediction.SampleCount,
                        AgeBand = ageBand?.ToString(),
                        Phase = phase.HasValue ? DayPhases.Label(phase.Value) : null,
                        Resolved = true,
                    });
                    existingKeys.Add(key);

                    // Flush in batches to keep memory and round-trips reasonable.
                    if (pendingBatch.Count >= 200)
                    {
                        await FlushBatchAsync(pendingBatch, cancellationToken);
                    }
                }

                created++;
            }
        }

        if (!dryRun && pendingBatch.Count > 0)
        {
            await FlushBatchAsync(pendingBatch, cancellationToken);
        }

        return (created, skipped);
    }

    private static ObservedEvent? FindNextEventOfType(ObservedEvent[] events, int startIndex, EventTypeKey typeKey)
    {
        for (var j = startIndex; j < events.Length; j++)
        {
            if (events[j].TypeKey == typeKey)
            {
                return events[j];
            }
        }

        return null;
    }

    private async Task FlushBatchAsync(List<PredictionOutcomeEntity> batch, CancellationToken cancellationToken)
    {
        context.PredictionOutcomes.AddRange(batch);
        await context.SaveChangesAsync(cancellationToken);
        batch.Clear();
    }

    private static ObservedEvent ToObserved(EventTypeKey key, DateTimeOffset startedAt, DateTimeOffset? endedAt, EventPayload payload)
    {
        var facts = EventPayloadFacts.Read(payload);
        var notCrying = key == BuiltInEventTypes.Fussy.Key && CryDetection.IsConfirmedNotCrying(payload);
        return new ObservedEvent(key, startedAt, endedAt, facts.Kind, facts.Paused, facts.Content, notCrying);
    }

    }