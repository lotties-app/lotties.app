using Lotties.Application.Predictions;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Application;

public sealed class PredictionOutcomeResolutionServiceTests
{
    private static readonly EventTypeKey FeedingKey = EventTypeKey.From("feeding");
    private static readonly DateTimeOffset Anchor = new(2025, 6, 15, 10, 0, 0, TimeSpan.Zero);
    private static readonly Guid BabyId = Guid.NewGuid();

    private static Prediction CreatePrediction(DateTimeOffset? anchorAt = null) => new(
        TypeKey: FeedingKey,
        NextStart: new NextStartWindow(
            Earliest: (anchorAt ?? Anchor).AddHours(2),
            Expected: (anchorAt ?? Anchor).AddHours(3),
            Latest: (anchorAt ?? Anchor).AddHours(4)),
        ExpectedDuration: null,
        Confidence: PredictionConfidence.Medium,
        SampleCount: 10,
        Reason: new PredictionReason(
            Basis: PredictionBasis.StartInterval,
            MedianGap: TimeSpan.FromHours(3),
            SampleCount: 10,
            LookBack: TimeSpan.FromDays(14),
            AgeBand: AgeBand.ThreeToSixMonths,
            Phase: DayPhase.Day,
            TypicalDuration: null,
            AssumesEventInProgressEnds: false),
        Origin: PriorOrigin.PublishedNorm,
        AnchorAt: anchorAt ?? Anchor);

    [Fact]
    public async Task RecordPredictionAsync_CreatesPendingOutcomeWithCorrectFields()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = true };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);
        var prediction = CreatePrediction();

        await service.RecordPredictionAsync(prediction, BabyId, "1.1");

        Assert.Single(repo.Saved);
        var outcome = repo.Saved[0];
        Assert.Equal(BabyId, outcome.BabyId);
        Assert.Equal(FeedingKey, outcome.TypeKey);
        Assert.Equal(prediction.NextStart.Expected, outcome.ExpectedNextStart);
        Assert.Null(outcome.ActualNextStart);
        Assert.Null(outcome.ErrorMinutes);
        Assert.Equal("1.1", outcome.EngineVersion);
        Assert.Equal(10, outcome.SampleCount);
        Assert.Equal(AgeBand.ThreeToSixMonths, outcome.AgeBand);
        Assert.Equal(DayPhase.Day, outcome.Phase);
    }

    [Fact]
    public async Task RecordPredictionAsync_DoesNothingWhenTrackingDisabled()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = false };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);

        await service.RecordPredictionAsync(CreatePrediction(), BabyId, "1.1");

        Assert.Empty(repo.Saved);
    }

    [Fact]
    public async Task ResolvePendingAsync_ResolvesOldestPendingOutcome()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = true };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);

        // Seed two pending outcomes; the first is older.
        var older = new PredictionOutcome(
            Guid.NewGuid(), BabyId, FeedingKey, Anchor.AddHours(-6), Anchor.AddHours(-6),
            Anchor.AddHours(-3), null, null, "1.1", 8, null, null);
        var newer = new PredictionOutcome(
            Guid.NewGuid(), BabyId, FeedingKey, Anchor, Anchor,
            Anchor.AddHours(3), null, null, "1.1", 10, null, null);
        repo.Pending[BabyId] = [older, newer];

        var actualNextStart = Anchor.AddHours(-2);
        await service.ResolvePendingAsync(BabyId, FeedingKey, actualNextStart);

        // The oldest should have been resolved and saved.
        Assert.Contains(repo.Saved, o => o.ActualNextStart == actualNextStart && o.ErrorMinutes is not null);
    }

    [Fact]
    public async Task ResolvePendingAsync_DoesNothingWhenNoPendingOutcomes()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = true };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);

        await service.ResolvePendingAsync(BabyId, FeedingKey, Anchor);

        Assert.Empty(repo.Saved);
    }

    [Fact]
    public async Task RecordPredictionAsync_DropsOldestWhenMaxPendingExceeded()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = true, MaxPendingOutcomes = 2 };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);

        // Pre-seed 2 pending outcomes so adding one more exceeds the limit.
        var old1 = new PredictionOutcome(
            Guid.NewGuid(), BabyId, FeedingKey, Anchor.AddHours(-10), Anchor.AddHours(-10),
            Anchor.AddHours(-7), null, null, "1.1", 5, null, null);
        var old2 = new PredictionOutcome(
            Guid.NewGuid(), BabyId, FeedingKey, Anchor.AddHours(-5), Anchor.AddHours(-5),
            Anchor.AddHours(-2), null, null, "1.1", 7, null, null);
        repo.Pending[BabyId] = [old1, old2];

        await service.RecordPredictionAsync(CreatePrediction(), BabyId, "1.1");

        // The new outcome plus at least one resolved (dropped) outcome should be saved.
        // old1 should be resolved with its own ExpectedNextStart (error = 0) to drop it.
        Assert.True(repo.Saved.Count >= 2, $"Expected at least 2 saves (new + dropped), got {repo.Saved.Count}");
        Assert.Contains(repo.Saved, o => o.ActualNextStart is not null && o.ErrorMinutes == 0);
    }

    /// <summary>In-memory fake of <see cref="IPredictionOutcomeRepository"/> for unit tests.</summary>
    private sealed class FakePredictionOutcomeRepository : IPredictionOutcomeRepository
    {
        public List<PredictionOutcome> Saved { get; } = [];
        public Dictionary<Guid, List<PredictionOutcome>> Pending { get; } = new();

        public Task SaveAsync(PredictionOutcome outcome, CancellationToken cancellationToken = default)
        {
            Saved.Add(outcome);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<PredictionOutcome>> GetPendingAsync(Guid babyId, EventTypeKey typeKey, CancellationToken cancellationToken = default)
        {
            // Combine pre-seeded pending outcomes with those saved via SaveAsync.
            var all = new List<PredictionOutcome>();
            if (Pending.TryGetValue(babyId, out var seeded))
            {
                all.AddRange(seeded);
            }
            all.AddRange(Saved);

            var filtered = all
                .Where(o => o.BabyId == babyId && o.TypeKey == typeKey && o.ActualNextStart is null)
                .ToList();
            return Task.FromResult<IReadOnlyList<PredictionOutcome>>(filtered);
        }

        public Task<IReadOnlyList<PredictionOutcome>> GetResolvedAsync(Guid babyId, EventTypeKey typeKey, int limit, CancellationToken cancellationToken = default)
        {
            var resolved = Saved
                .Where(o => o.BabyId == babyId && o.TypeKey == typeKey && o.ErrorMinutes is not null)
                .Take(limit)
                .ToList();
            return Task.FromResult<IReadOnlyList<PredictionOutcome>>(resolved);
        }

        public Task<double?> GetMaeAsync(Guid babyId, EventTypeKey typeKey, AgeBand? ageBand, DayPhase? phase, int minSamples, CancellationToken cancellationToken = default)
        {
            // Tests don't exercise accuracy adjustment; always return null.
            return Task.FromResult<double?>(null);
        }

        public List<(Guid BabyId, EventTypeKey TypeKey, DateTimeOffset OldAnchorAt)> Invalidated { get; } = [];

        public Task InvalidateByAnchorAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default)
        {
            Invalidated.Add((babyId, typeKey, oldAnchorAt));
            // Also remove any saved resolved outcomes matching the anchor so subsequent GetPending calls are consistent.
            Saved.RemoveAll(o => o.BabyId == babyId && o.TypeKey == typeKey && o.AnchorAt == oldAnchorAt && o.ActualNextStart is not null);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task InvalidateStaleOutcomeAsync_DelegatesToRepository()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = true };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);
        var oldAnchor = Anchor.AddHours(-3);

        await service.InvalidateStaleOutcomeAsync(BabyId, FeedingKey, oldAnchor);

        Assert.Single(repo.Invalidated);
        Assert.Equal(BabyId, repo.Invalidated[0].BabyId);
        Assert.Equal(FeedingKey, repo.Invalidated[0].TypeKey);
        Assert.Equal(oldAnchor, repo.Invalidated[0].OldAnchorAt);
    }

    [Fact]
    public async Task InvalidateStaleOutcomeAsync_DoesNothingWhenTrackingDisabled()
    {
        var repo = new FakePredictionOutcomeRepository();
        var options = new PredictionOptions { AccuracyTrackingEnabled = false };
        var service = new PredictionOutcomeResolutionService(repo, options, NullLogger<PredictionOutcomeResolutionService>.Instance);

        await service.InvalidateStaleOutcomeAsync(BabyId, FeedingKey, Anchor);

        Assert.Empty(repo.Invalidated);
    }
}