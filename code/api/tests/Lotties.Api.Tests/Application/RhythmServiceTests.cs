using Lotties.Application.Rhythm;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Application;

public sealed class RhythmServiceTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 1, 29, 15, 0, 0, TimeSpan.FromHours(-3));

    [Fact]
    public async Task GetAsync_UnknownBaby_ReturnsNull()
    {
        var service = new RhythmService(new FakeHistory(null), NullLogger<RhythmService>.Instance);

        Assert.Null(await service.GetAsync(BabyId, Now));
    }

    [Fact]
    public async Task GetAsync_LoadsFromTheLocalStartOfTheDayBeforeTheWindow()
    {
        var repository = new FakeHistory(new PredictionHistory(new DateOnly(2025, 11, 1), []));

        var response = await new RhythmService(repository, NullLogger<RhythmService>.Instance).GetAsync(BabyId, Now, "America/Sao_Paulo");

        Assert.Equal((BabyId, new DateTimeOffset(2025, 12, 31, 0, 0, 0, TimeSpan.FromHours(-3))), Assert.Single(repository.Calls));
        Assert.Equal(("America/Sao_Paulo", "2026-01-01", "2026-01-28"), (response!.TimeZone, response.FirstDay, response.LastDay));
    }

    private sealed class FakeHistory(PredictionHistory? history) : IPredictionHistoryRepository
    {
        public List<(Guid BabyId, DateTimeOffset Since)> Calls { get; } = [];

        public Task<PredictionHistory?> LoadAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default)
        {
            Calls.Add((babyId, since));
            return Task.FromResult(history);
        }
    }
}
