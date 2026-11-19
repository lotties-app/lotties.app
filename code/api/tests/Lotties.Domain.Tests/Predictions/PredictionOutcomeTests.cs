using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class PredictionOutcomeTests
{
    private static readonly EventTypeKey FeedingKey = EventTypeKey.From("feeding");
    private static readonly DateTimeOffset Anchor = new(2025, 6, 15, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Expected = Anchor.AddHours(3);

    private static PredictionOutcome CreatePending() => new(
        Id: Guid.NewGuid(),
        BabyId: Guid.NewGuid(),
        TypeKey: FeedingKey,
        PredictedAt: Anchor,
        AnchorAt: Anchor,
        ExpectedNextStart: Expected,
        ActualNextStart: null,
        ErrorMinutes: null,
        EngineVersion: "1.1",
        SampleCount: 10,
        AgeBand: AgeBand.ThreeToSixMonths,
        Phase: DayPhase.Day);

    [Fact]
    public void Resolve_ComputesCorrectErrorMinutes()
    {
        var outcome = CreatePending();
        var actual = Expected.AddMinutes(45);

        var resolved = outcome.Resolve(actual);

        Assert.Equal(45.0, resolved.ErrorMinutes);
        Assert.Equal(actual, resolved.ActualNextStart);
    }

    [Fact]
    public void Resolve_ActualEqualsExpected_GivesZeroError()
    {
        var outcome = CreatePending();

        var resolved = outcome.Resolve(Expected);

        Assert.Equal(0.0, resolved.ErrorMinutes);
        Assert.Equal(Expected, resolved.ActualNextStart);
    }

    [Fact]
    public void Resolve_ActualBeforeExpected_GivesPositiveError()
    {
        var outcome = CreatePending();
        var actual = Expected.AddMinutes(-30);

        var resolved = outcome.Resolve(actual);

        Assert.Equal(30.0, resolved.ErrorMinutes);
        Assert.Equal(actual, resolved.ActualNextStart);
    }

    [Fact]
    public void Unresolved_HasNullActualAndError()
    {
        var outcome = CreatePending();

        Assert.Null(outcome.ActualNextStart);
        Assert.Null(outcome.ErrorMinutes);
    }
}

public sealed class PredictionAccuracyCalculatorTests
{
    private static readonly EventTypeKey FeedingKey = EventTypeKey.From("feeding");
    private static readonly DateTimeOffset Anchor = new(2025, 6, 15, 10, 0, 0, TimeSpan.Zero);

    private static PredictionOutcome CreateResolved(double errorMinutes, AgeBand? ageBand = null, DayPhase? phase = null) => new(
        Id: Guid.NewGuid(),
        BabyId: Guid.NewGuid(),
        TypeKey: FeedingKey,
        PredictedAt: Anchor,
        AnchorAt: Anchor,
        ExpectedNextStart: Anchor.AddHours(3),
        ActualNextStart: Anchor.AddHours(3).AddMinutes(errorMinutes),
        ErrorMinutes: Math.Abs(errorMinutes),
        EngineVersion: "1.1",
        SampleCount: 10,
        AgeBand: ageBand,
        Phase: phase);

    private static PredictionOutcome CreateUnresolved() => new(
        Id: Guid.NewGuid(),
        BabyId: Guid.NewGuid(),
        TypeKey: FeedingKey,
        PredictedAt: Anchor,
        AnchorAt: Anchor,
        ExpectedNextStart: Anchor.AddHours(3),
        ActualNextStart: null,
        ErrorMinutes: null,
        EngineVersion: "1.1",
        SampleCount: 10,
        AgeBand: AgeBand.ThreeToSixMonths,
        Phase: DayPhase.Day);

    [Fact]
    public void Compute_EmptyList_ReturnsNull()
    {
        var result = PredictionAccuracyCalculator.Compute([]);

        Assert.Null(result);
    }

    [Fact]
    public void Compute_OneResolved_ReturnsItsErrorAsMae()
    {
        var outcomes = new[] { CreateResolved(20.0) };

        var result = PredictionAccuracyCalculator.Compute(outcomes);

        Assert.NotNull(result);
        Assert.Equal(20.0, result!.MaeMinutes);
        Assert.Equal(1, result.ResolvedCount);
    }

    [Fact]
    public void Compute_MultipleOutcomes_ReturnsCorrectAverage()
    {
        var outcomes = new[] { CreateResolved(10.0), CreateResolved(20.0), CreateResolved(30.0) };

        var result = PredictionAccuracyCalculator.Compute(outcomes);

        Assert.NotNull(result);
        Assert.Equal(20.0, result!.MaeMinutes);
        Assert.Equal(3, result.ResolvedCount);
    }

    [Fact]
    public void Compute_FiltersOutUnresolved()
    {
        var outcomes = new[] { CreateResolved(10.0), CreateUnresolved(), CreateResolved(30.0) };

        var result = PredictionAccuracyCalculator.Compute(outcomes);

        Assert.NotNull(result);
        Assert.Equal(20.0, result!.MaeMinutes);
        Assert.Equal(2, result.ResolvedCount);
    }

    [Fact]
    public void Compute_AllUnresolved_ReturnsNull()
    {
        var outcomes = new[] { CreateUnresolved(), CreateUnresolved() };

        var result = PredictionAccuracyCalculator.Compute(outcomes);

        Assert.Null(result);
    }

    [Fact]
    public void Compute_PreservesAgeBandAndPhase()
    {
        var outcomes = new[] { CreateResolved(15.0, AgeBand.SixToTwelveMonths, DayPhase.Night) };

        var result = PredictionAccuracyCalculator.Compute(outcomes);

        Assert.NotNull(result);
        Assert.Equal(AgeBand.SixToTwelveMonths, result!.AgeBand);
        Assert.Equal(DayPhase.Night, result.Phase);
    }
}