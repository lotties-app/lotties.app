using Lotties.Api.Tests.Support;
using Lotties.Application.Predictions;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Application;

/// <summary>
/// <see cref="PredictionOutcomeResolutionService"/> over the real EF repository (<c>prediction_outcomes</c> on the SQLite test
/// database, the baby entered in the scope as the routes and jobs enter it).
/// </summary>
public sealed class PredictionOutcomeResolutionServiceTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly EventTypeKey FeedingKey = EventTypeKey.From("feeding");
    private static readonly DateTimeOffset Anchor = new(2025, 6, 15, 10, 0, 0, TimeSpan.Zero);
    private static readonly PredictionOptions Tracking = new() { AccuracyTrackingEnabled = true };

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

    private static PredictionOutcome Pending(Guid babyId, DateTimeOffset anchorAt, DateTimeOffset expected) =>
        new(Guid.NewGuid(), babyId, FeedingKey, anchorAt, anchorAt, expected, null, null, "1.1", 8, null, null);

    [Fact]
    public async Task RecordPredictionAsync_CreatesPendingOutcomeWithCorrectFields()
    {
        var babyId = await SeedBabyAsync();
        var prediction = CreatePrediction();

        await WithServiceAsync(babyId, Tracking, (service, _) => service.RecordPredictionAsync(prediction, babyId, "1.1"));

        var outcome = Assert.Single(await RowsAsync(babyId));
        Assert.Equal(FeedingKey.Value, outcome.TypeKey);
        Assert.Equal(prediction.NextStart.Expected, outcome.ExpectedNextStart);
        Assert.Equal(prediction.AnchorAt, outcome.AnchorAt);
        Assert.Null(outcome.ActualNextStart);
        Assert.Null(outcome.ErrorMinutes);
        Assert.False(outcome.Resolved);
        Assert.Equal("1.1", outcome.EngineVersion);
        Assert.Equal(10, outcome.SampleCount);
        Assert.Equal(nameof(AgeBand.ThreeToSixMonths), outcome.AgeBand);
        Assert.Equal(nameof(DayPhase.Day), outcome.Phase);
    }

    [Fact]
    public async Task RecordPredictionAsync_DoesNothingWhenTrackingDisabled()
    {
        var babyId = await SeedBabyAsync();

        await WithServiceAsync(babyId, new PredictionOptions { AccuracyTrackingEnabled = false }, (service, _) => service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1"));

        Assert.Empty(await RowsAsync(babyId));
    }

    [Fact]
    public async Task RecordPredictionAsync_SameAnchorTwice_RecordsOneOutcome()
    {
        var babyId = await SeedBabyAsync();

        await WithServiceAsync(babyId, Tracking, async (service, _) =>
        {
            await service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1");
            await service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1");
            await service.RecordPredictionAsync(CreatePrediction(Anchor.AddHours(3)), babyId, "1.1");
        });

        var rows = await RowsAsync(babyId);
        Assert.Equal([Anchor, Anchor.AddHours(3)], rows.Select(row => row.AnchorAt).Order().ToArray());
    }

    [Fact]
    public async Task RecordPredictionAsync_OverTheLimit_ExpiresTheOldestWithoutAScore_AndMaeLeavesThemOut()
    {
        var babyId = await SeedBabyAsync();
        var options = Tracking with { MaxPendingOutcomes = 2 };
        // One real measurement: 30 minutes off.
        var measured = Pending(babyId, Anchor.AddDays(-1), Anchor.AddDays(-1).AddHours(3)).Resolve(Anchor.AddDays(-1).AddHours(3).AddMinutes(30));

        double? mae = null;
        IReadOnlyList<PredictionOutcome> pending = [];
        await WithServiceAsync(babyId, options, async (service, repository) =>
        {
            await repository.SaveAsync(measured);
            await repository.SaveAsync(Pending(babyId, Anchor.AddHours(-10), Anchor.AddHours(-7)));
            await repository.SaveAsync(Pending(babyId, Anchor.AddHours(-5), Anchor.AddHours(-2)));

            await service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1");

            pending = await repository.GetPendingAsync(babyId, FeedingKey);
            mae = await repository.GetMaeAsync(babyId, FeedingKey, null, null, minSamples: 1);
        });

        Assert.Equal([Anchor.AddHours(-5), Anchor], pending.Select(outcome => outcome.AnchorAt).ToArray());
        var expired = Assert.Single(await RowsAsync(babyId), row => row.AnchorAt == Anchor.AddHours(-10));
        Assert.True(expired.Resolved);
        Assert.Null(expired.ActualNextStart);
        Assert.Null(expired.ErrorMinutes);
        // Only the real measurement counts: an expired outcome closed with error 0 would have pulled this to 15.
        Assert.Equal(30, mae!.Value, 3);
    }

    [Fact]
    public async Task ResolvePendingAsync_EventsWrittenOutOfOrder_ResolveWithTheFirstEventAfterTheAnchor()
    {
        var babyId = await SeedBabyAsync();
        var first = Pending(babyId, Anchor, Anchor.AddHours(3));

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(first);
            // The later event arrives first (an outbox flushing), then the earlier one.
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(5));
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(2));
            // Writing the later one again (an edit of its notes) changes nothing.
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(5));
        });

        var row = Assert.Single(await RowsAsync(babyId));
        Assert.Equal((true, Anchor.AddHours(2)), (row.Resolved, row.ActualNextStart));
        Assert.Equal(60, row.ErrorMinutes!.Value, 3);
    }

    [Fact]
    public async Task ResolvePendingAsync_EachOutcomeGetsTheFirstEventAfterItsOwnAnchor()
    {
        var babyId = await SeedBabyAsync();
        var early = Pending(babyId, Anchor, Anchor.AddHours(3));
        var late = Pending(babyId, Anchor.AddHours(4), Anchor.AddHours(7));

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(early);
            await repository.SaveAsync(late);
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(8));
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(3));
            // At or before an anchor: not that outcome's next event.
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(4));
        });

        var rows = (await RowsAsync(babyId)).ToDictionary(row => row.Id);
        Assert.Equal(Anchor.AddHours(3), rows[early.Id].ActualNextStart);
        Assert.Equal(0, rows[early.Id].ErrorMinutes!.Value, 3);
        Assert.Equal(Anchor.AddHours(8), rows[late.Id].ActualNextStart);
        Assert.Equal(60, rows[late.Id].ErrorMinutes!.Value, 3);
    }

    [Fact]
    public async Task ResolvePendingAsync_EventBeforeTheAnchor_LeavesTheOutcomePending()
    {
        var babyId = await SeedBabyAsync();

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(Pending(babyId, Anchor, Anchor.AddHours(3)));
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(-1));
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor);
        });

        Assert.False(Assert.Single(await RowsAsync(babyId)).Resolved);
    }

    [Fact]
    public async Task TryResolveAsync_RowAlreadyHoldsAnEarlierEvent_IsNotOverwritten()
    {
        var babyId = await SeedBabyAsync();
        var outcome = Pending(babyId, Anchor, Anchor.AddHours(3));
        bool laterWritten = true;
        bool earlierWritten = false;

        await WithServiceAsync(babyId, Tracking, async (_, repository) =>
        {
            await repository.SaveAsync(outcome);
            Assert.True(await repository.TryResolveAsync(outcome.Resolve(Anchor.AddHours(2))));
            // A concurrent resolution with a later event that read the row while it was still pending.
            laterWritten = await repository.TryResolveAsync(outcome.Resolve(Anchor.AddHours(6)));
            earlierWritten = await repository.TryResolveAsync(outcome.Resolve(Anchor.AddHours(1)));
        });

        Assert.False(laterWritten);
        Assert.True(earlierWritten);
        Assert.Equal(Anchor.AddHours(1), Assert.Single(await RowsAsync(babyId)).ActualNextStart);
    }

    [Fact]
    public async Task ResolvePendingAsync_ExpiredOutcome_StaysExpired()
    {
        var babyId = await SeedBabyAsync();

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(Pending(babyId, Anchor, Anchor.AddHours(3)).Expire());
            await service.ResolvePendingAsync(babyId, FeedingKey, Anchor.AddHours(2));
        });

        var row = Assert.Single(await RowsAsync(babyId));
        Assert.Equal((true, (DateTimeOffset?)null, (double?)null), (row.Resolved, row.ActualNextStart, row.ErrorMinutes));
    }

    [Fact]
    public async Task ResolvePendingAsync_DoesNothingWhenNoPendingOutcomes()
    {
        var babyId = await SeedBabyAsync();

        await WithServiceAsync(babyId, Tracking, (service, _) => service.ResolvePendingAsync(babyId, FeedingKey, Anchor));

        Assert.Empty(await RowsAsync(babyId));
    }

    [Fact]
    public async Task RecordPredictionAsync_RetentionOn_DeletesEveryOutcomeOfTheBabyAnchoredBeforeIt_KeepsRecentOnes()
    {
        var babyId = await SeedBabyAsync();
        var otherBabyId = await SeedBabyAsync();
        var now = Anchor.AddHours(1);
        var options = Tracking with { OutcomeRetentionDays = 30 };
        var oldResolved = Pending(babyId, now.AddDays(-40), now.AddDays(-40).AddHours(3)).Resolve(now.AddDays(-40).AddHours(4));
        var oldExpired = Pending(babyId, now.AddDays(-39), now.AddDays(-39).AddHours(3)).Expire();
        // Pending rows that never resolve and rows of another event type go too.
        var oldPending = Pending(babyId, now.AddDays(-38), now.AddDays(-38).AddHours(3));
        var oldOtherType = Pending(babyId, now.AddDays(-35), now.AddDays(-35).AddHours(2)) with { TypeKey = EventTypeKey.From("sleep") };
        var recentResolved = Pending(babyId, now.AddDays(-2), now.AddDays(-2).AddHours(3)).Resolve(now.AddDays(-2).AddHours(4));
        var recentPending = Pending(babyId, now.AddDays(-29), now.AddDays(-29).AddHours(3));
        var otherBabyOld = Pending(otherBabyId, now.AddDays(-40), now.AddDays(-40).AddHours(3));

        await WithServiceAsync(otherBabyId, options, (_, repository) => repository.SaveAsync(otherBabyOld), now);
        await WithServiceAsync(babyId, options, async (service, repository) =>
        {
            foreach (var outcome in new[] { oldResolved, oldExpired, oldPending, oldOtherType, recentResolved, recentPending })
            {
                await repository.SaveAsync(outcome);
            }

            await service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1");
        }, now);

        var ids = (await RowsAsync(babyId)).Select(row => row.Id).ToHashSet();
        Assert.DoesNotContain(oldResolved.Id, ids);
        Assert.DoesNotContain(oldExpired.Id, ids);
        Assert.DoesNotContain(oldPending.Id, ids);
        Assert.DoesNotContain(oldOtherType.Id, ids);
        Assert.Contains(recentResolved.Id, ids);
        Assert.Contains(recentPending.Id, ids);
        Assert.Equal(3, ids.Count);
        // Another baby's rows wait for a new outcome of her own.
        Assert.Contains(otherBabyOld.Id, (await RowsAsync(otherBabyId)).Select(row => row.Id));
    }

    [Fact]
    public async Task RecordPredictionAsync_RetentionOn_AnchorAlreadyRecorded_DeletesNothing()
    {
        var babyId = await SeedBabyAsync();
        var now = Anchor.AddHours(1);
        var options = Tracking with { OutcomeRetentionDays = 30 };
        var old = Pending(babyId, now.AddDays(-40), now.AddDays(-40).AddHours(3)).Resolve(now.AddDays(-40).AddHours(4));
        var current = Pending(babyId, Anchor, Anchor.AddHours(3));

        await WithServiceAsync(babyId, options, async (service, repository) =>
        {
            await repository.SaveAsync(old);
            await repository.SaveAsync(current);
            // Same history as the stored outcome: nothing new is recorded, so retention does not run.
            await service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1");
        }, now);

        Assert.Equal(new[] { old.Id, current.Id }.Order(), (await RowsAsync(babyId)).Select(row => row.Id).Order());
    }

    [Fact]
    public async Task RecordPredictionAsync_RetentionOffByDefault_KeepsEverything()
    {
        var babyId = await SeedBabyAsync();
        var now = Anchor.AddHours(1);
        var old = Pending(babyId, now.AddDays(-400), now.AddDays(-400).AddHours(3)).Resolve(now.AddDays(-400).AddHours(4));

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(old);
            await service.RecordPredictionAsync(CreatePrediction(), babyId, "1.1");
        }, now);

        Assert.Contains(old.Id, (await RowsAsync(babyId)).Select(row => row.Id));
    }

    [Fact]
    public async Task RecordFeedbackAsync_IsoExpectedNextStart_ResolvesThatOutcome()
    {
        var babyId = await SeedBabyAsync();
        var expected = new DateTimeOffset(2025, 6, 15, 13, 0, 0, 123, TimeSpan.Zero).AddTicks(4567);
        var other = Pending(babyId, Anchor.AddHours(-3), Anchor);
        var rated = Pending(babyId, Anchor, expected);

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(other);
            await repository.SaveAsync(rated);
            // What the web sends: JavaScript's toISOString (milliseconds, UTC).
            await service.RecordFeedbackAsync(babyId, "feeding:2025-06-15T13:00:00.123Z", accurate: true);
        });

        var rows = (await RowsAsync(babyId)).ToDictionary(row => row.Id);
        Assert.Equal((true, (double?)0), (rows[rated.Id].Resolved, rows[rated.Id].ErrorMinutes));
        Assert.False(rows[other.Id].Resolved);
    }

    [Fact]
    public async Task RecordFeedbackAsync_LegacyTicks_StillResolveByPredictedAt()
    {
        var babyId = await SeedBabyAsync();
        var rated = Pending(babyId, Anchor, Anchor.AddHours(3));

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(rated);
            await service.RecordFeedbackAsync(babyId, $"feeding:{Anchor.UtcTicks}", accurate: false);
        });

        var row = Assert.Single(await RowsAsync(babyId));
        Assert.Equal(Anchor.AddHours(27), row.ActualNextStart);
    }

    [Theory]
    [InlineData("feeding:2025-06-15T13:00:00.123Z", false, "2025-06-15T13:00:00.1230000+00:00")]
    [InlineData("feeding:2025-06-15T10:00:00-03:00", false, "2025-06-15T13:00:00.0000000+00:00")]
    [InlineData("tummy_time:2025-06-15T13:00:00", false, "2025-06-15T13:00:00.0000000+00:00")]
    public void TryParsePredictionId_AcceptsIso(string id, bool isTicks, string instant)
    {
        Assert.True(PredictionOutcomeResolutionService.TryParsePredictionId(id, out var typeKey, out var parsed, out var ticks));
        Assert.Equal(id.Split(':')[0], typeKey.Value);
        Assert.Equal(isTicks, ticks);
        Assert.Equal(DateTimeOffset.Parse(instant, System.Globalization.CultureInfo.InvariantCulture), parsed);
        Assert.Equal(TimeSpan.Zero, parsed.Offset);
    }

    [Fact]
    public void TryParsePredictionId_AcceptsTicks()
    {
        Assert.True(PredictionOutcomeResolutionService.TryParsePredictionId($"feeding:{Anchor.UtcTicks}", out var typeKey, out var parsed, out var ticks));
        Assert.Equal((FeedingKey, Anchor, true), (typeKey, parsed, ticks));
    }

    [Theory]
    [InlineData("")]
    [InlineData("feeding")]
    [InlineData("feeding:")]
    [InlineData("Feeding:2025-06-15T13:00:00Z")]
    [InlineData("feeding:13:00:00")]
    [InlineData("feeding:not-a-date")]
    [InlineData("feeding:99999999999999999999")]
    public void TryParsePredictionId_RejectsOtherForms(string id)
    {
        Assert.False(PredictionOutcomeResolutionService.TryParsePredictionId(id, out _, out _, out _));
    }

    [Fact]
    public async Task InvalidateStaleOutcomeAsync_RemovesResolvedOutcomesAtTheOldAnchorOnly()
    {
        var babyId = await SeedBabyAsync();
        var stale = Pending(babyId, Anchor, Anchor.AddHours(3)).Resolve(Anchor.AddHours(4));
        var pendingAtAnchor = Pending(babyId, Anchor, Anchor.AddHours(3));
        var other = Pending(babyId, Anchor.AddHours(-3), Anchor).Resolve(Anchor);

        await WithServiceAsync(babyId, Tracking, async (service, repository) =>
        {
            await repository.SaveAsync(stale);
            await repository.SaveAsync(pendingAtAnchor);
            await repository.SaveAsync(other);
            await service.InvalidateStaleOutcomeAsync(babyId, FeedingKey, Anchor);
        });

        Assert.Equal(new[] { pendingAtAnchor.Id, other.Id }.Order(), (await RowsAsync(babyId)).Select(row => row.Id).Order());
    }

    [Fact]
    public async Task InvalidateStaleOutcomeAsync_DoesNothingWhenTrackingDisabled()
    {
        var babyId = await SeedBabyAsync();
        var stale = Pending(babyId, Anchor, Anchor.AddHours(3)).Resolve(Anchor.AddHours(4));

        await WithServiceAsync(babyId, new PredictionOptions { AccuracyTrackingEnabled = false }, async (service, repository) =>
        {
            await repository.SaveAsync(stale);
            await service.InvalidateStaleOutcomeAsync(babyId, FeedingKey, Anchor);
        });

        Assert.Single(await RowsAsync(babyId));
    }

    private async Task<Guid> SeedBabyAsync() => (await factory.SeedBabyAsync(BabyRole.Parent)).BabyId;

    /// <summary>The service over the real repository, in a scope of its own with the baby entered.</summary>
    private async Task WithServiceAsync(
        Guid babyId, PredictionOptions options, Func<PredictionOutcomeResolutionService, IPredictionOutcomeRepository, Task> action, DateTimeOffset? now = null)
    {
        await using var scope = await factory.CreateScopeForAsync(babyId);
        var repository = scope.ServiceProvider.GetRequiredService<IPredictionOutcomeRepository>();
        var service = new PredictionOutcomeResolutionService(
            repository, options, new FixedTimeProvider(now ?? Anchor), NullLogger<PredictionOutcomeResolutionService>.Instance);
        await action(service, repository);
    }

    private Task<List<Infrastructure.Persistence.Entities.PredictionOutcomeEntity>> RowsAsync(Guid babyId) =>
        factory.QueryAsync(context => context.PredictionOutcomes.AsNoTracking().Where(row => row.BabyId == babyId).ToListAsync());
}
