using Lotties.Api.Tests.Support;
using Lotties.Application.Predictions;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Application;

public sealed class PredictionServiceTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3));
    private static readonly EventTypeKey TummyTime = BuiltInEventTypes.TummyTime.Key;
    private static readonly EventTypeKey Sleep = BuiltInEventTypes.Sleep.Key;

    [Fact]
    public async Task GetAsync_UnknownBaby_ReturnsNull()
    {
        var service = CreateService(new FakePredictionHistoryRepository(null));

        Assert.Null(await service.GetAsync(BabyId, Now));
    }

    [Fact]
    public async Task GetAsync_LoadsLookBackWindowForBaby()
    {
        var repository = new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), []));

        await CreateService(repository).GetAsync(BabyId, Now);

        Assert.Equal((BabyId, Now - PredictionOptions.Default.LookBack), Assert.Single(repository.Calls));
    }

    [Fact]
    public async Task GetAsync_RegularEvents_MapsPredictionToResponse()
    {
        var events = Enumerable.Range(1, 12)
            .Select(index => Now.AddHours(-3 * index))
            .Select(start => new ObservedEvent(TummyTime, start, start.AddMinutes(20)))
            .ToArray();
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), events)));

        var response = await service.GetAsync(BabyId, Now);

        Assert.Equal(BabyId, response!.BabyId);
        Assert.Equal(TimeSpan.Zero, response.GeneratedAt.Offset);
        var prediction = Assert.Single(response.Predictions);
        Assert.Equal("tummy_time", prediction.TypeKey);
        Assert.Equal(Now, prediction.NextStart.Expected);
        Assert.Equal(TimeSpan.Zero, prediction.NextStart.Expected.Offset);
        Assert.Equal(20, prediction.ExpectedDuration!.Minutes);
        Assert.Equal("Medium", prediction.Confidence);
        Assert.Equal(11, prediction.SampleCount);
        Assert.Equal("StartInterval", prediction.Basis.Kind);
        Assert.Equal(180, prediction.Basis.MedianGapMinutes);
        Assert.Equal(14, prediction.Basis.LookBackDays);
        Assert.StartsWith("Median every 3h over the last 14 days", prediction.Reason);
        Assert.Empty(response.InsufficientData);
    }

    [Fact]
    public async Task GetAsync_RecentNights_MapsBedTimeAndEngineVersion()
    {
        var events = Enumerable.Range(1, 6)
            .Select(day => new DateTimeOffset(2026, 1, 10 - day, 20, 0, 0, TimeSpan.FromHours(-3)))
            .SelectMany(bedTime => new[]
            {
                new ObservedEvent(Sleep, bedTime, bedTime, SleepKinds.BedTime),
                new ObservedEvent(Sleep, bedTime.AddHours(10), bedTime.AddHours(10), SleepKinds.WokeUp),
            })
            .ToArray();
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), events)));

        var response = await service.GetAsync(BabyId, Now);

        Assert.Equal("heuristic-1.1", response!.EngineVersion);
        var bedTime = response.BedTime!;
        Assert.Equal("sleep", bedTime.TypeKey);
        Assert.Equal("night", bedTime.Kind);
        Assert.Equal(new DateTimeOffset(2026, 1, 10, 23, 0, 0, TimeSpan.Zero), bedTime.NextStart.Expected);
        Assert.Equal(TimeSpan.Zero, bedTime.NextStart.Expected.Offset);
        Assert.Equal(600, bedTime.ExpectedDuration!.Minutes);
        Assert.Equal("Low", bedTime.Confidence);
        Assert.Equal(6, bedTime.SampleCount);
        Assert.StartsWith("Median bed time 20:00 over the last 14 days, 6 samples", bedTime.Reason);
        Assert.Equal("BedTimeClock", bedTime.Basis.Kind);
        Assert.Equal(6, bedTime.Basis.SampleCount);
        Assert.Equal(6, bedTime.Basis.RecentBedTimeCount);
        Assert.Equal(14, bedTime.Basis.LookBackDays);
        Assert.Equal("20:00", bedTime.Basis.MedianClock);
    }

    [Fact]
    public async Task GetAsync_NoNights_HasNoBedTime()
    {
        var events = new[] { new ObservedEvent(TummyTime, Now.AddHours(-1), Now.AddMinutes(-40)) };
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), events)));

        var response = await service.GetAsync(BabyId, Now);

        Assert.Null(response!.BedTime);
        Assert.Equal("heuristic-1.1", response.EngineVersion);
    }

    [Fact]
    public async Task GetAsync_TooFewEvents_ListsInsufficientData()
    {
        var events = new[] { new ObservedEvent(TummyTime, Now.AddHours(-1), Now.AddMinutes(-40)) };
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), events)));

        var response = await service.GetAsync(BabyId, Now);

        Assert.Empty(response!.Predictions);
        var missing = Assert.Single(response.InsufficientData);
        Assert.Equal("tummy_time", missing.TypeKey);
        Assert.Equal(0, missing.SampleCount);
        Assert.Equal(3, missing.RequiredSamples);
    }

    [Fact]
    public async Task GetAsync_DoctorWithoutMedications_LeavesOutTheMedicationDoses()
    {
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), RegularDoses())), DoctorOf([DoctorScope.DailyLog]));

        var response = await service.GetAsync(BabyId, Now);

        Assert.DoesNotContain("medication", TypeKeysOf(response!));
        Assert.Contains("tummy_time", TypeKeysOf(response!));
    }

    [Fact]
    public async Task GetAsync_DoctorWithMedications_KeepsTheMedicationDoses()
    {
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), RegularDoses())), DoctorOf([DoctorScope.DailyLog, DoctorScope.Medications]));

        var response = await service.GetAsync(BabyId, Now);

        Assert.Contains("medication", TypeKeysOf(response!));
    }

    [Fact]
    public async Task GetAsync_Parent_KeepsTheMedicationDoses()
    {
        var service = CreateService(new FakePredictionHistoryRepository(new PredictionHistory(new DateOnly(2025, 11, 1), RegularDoses())));

        var response = await service.GetAsync(BabyId, Now);

        Assert.Contains("medication", TypeKeysOf(response!));
    }

    /// <summary>A dose and a tummy time every three hours.</summary>
    private static ObservedEvent[] RegularDoses() =>
        Enumerable.Range(1, 12)
            .Select(index => Now.AddHours(-3 * index))
            .SelectMany(start => new[]
            {
                new ObservedEvent(BuiltInEventTypes.Medication.Key, start, null),
                new ObservedEvent(TummyTime, start, start.AddMinutes(20)),
            })
            .ToArray();

    private static string[] TypeKeysOf(PredictionsResponse response) =>
        response.Predictions.Select(item => item.TypeKey).Concat(response.InsufficientData.Select(item => item.TypeKey)).ToArray();

    private static BabyMember OwnerOf()
    {
        var baby = Baby.Create("Lia", new DateOnly(2025, 11, 1), Guid.NewGuid(), Now);
        return baby.Members.Single();
    }

    private static BabyMember DoctorOf(IReadOnlyCollection<DoctorScope> scopes)
    {
        var ownerId = Guid.NewGuid();
        var baby = Baby.Create("Lia", new DateOnly(2025, 11, 1), ownerId, Now);
        var issued = Invite.Issue(baby.Id, BabyRole.Doctor, ownerId, Now, TimeSpan.FromDays(7), DoctorScopeSet.Create(scopes));
        return baby.AdmitWith(issued.Invite, Guid.NewGuid(), Now, isDeclaredProfessional: true);
    }

    private static PredictionService CreateService(IPredictionHistoryRepository repository, BabyMember? caller = null) =>
        new(repository, new FakeBabyAccessService(BabyAccessDecision.Granted, caller ?? OwnerOf()), PredictionOptions.Default, NullLogger<PredictionService>.Instance);

    private sealed class FakePredictionHistoryRepository(PredictionHistory? history) : IPredictionHistoryRepository
    {
        public List<(Guid BabyId, DateTimeOffset Since)> Calls { get; } = [];

        public Task<PredictionHistory?> LoadAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default)
        {
            Calls.Add((babyId, since));
            return Task.FromResult(history);
        }
    }
}
