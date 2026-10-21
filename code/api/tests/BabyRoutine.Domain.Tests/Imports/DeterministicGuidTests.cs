using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Domain.Tests.Imports;

public sealed class DeterministicGuidTests
{
    private static readonly Guid DnsNamespace = new("6ba7b810-9dad-11d1-80b4-00c04fd430c8");

    [Fact]
    public void Create_KnownRfc4122Vector_MatchesReferenceImplementation()
    {
        var id = DeterministicGuid.Create(DnsNamespace, "python.org");

        Assert.Equal(new Guid("886313e1-3b8a-5372-9b90-0c9aee199e5d"), id);
    }

    [Fact]
    public void Create_SameInput_ReturnsSameIdOtherwiseDifferent()
    {
        Assert.Equal(DeterministicGuid.Create(DnsNamespace, "a"), DeterministicGuid.Create(DnsNamespace, "a"));
        Assert.NotEqual(DeterministicGuid.Create(DnsNamespace, "a"), DeterministicGuid.Create(DnsNamespace, "b"));
    }

    [Fact]
    public void EventId_SameInstantInAnotherOffset_IsTheSameId()
    {
        var local = new DateTimeOffset(2025, 9, 1, 8, 0, 0, TimeSpan.FromHours(-3));

        var fromLocal = ImportIds.Event(ImportTestData.BabyId, "NAP", local, local.AddHours(1), 0);
        var fromUtc = ImportIds.Event(ImportTestData.BabyId, "NAP", local.ToUniversalTime(), local.AddHours(1).ToUniversalTime(), 0);

        Assert.Equal(fromLocal, fromUtc);
    }

    [Fact]
    public void EventId_DifferentBabyOrOrdinal_IsDifferent()
    {
        var start = ImportTestData.Offset;
        var id = ImportIds.Event(ImportTestData.BabyId, "NAP", start, start, 0);

        Assert.NotEqual(id, ImportIds.Event(Guid.NewGuid(), "NAP", start, start, 0));
        Assert.NotEqual(id, ImportIds.Event(ImportTestData.BabyId, "NAP", start, start, 1));
    }

    [Fact]
    public void MeasurementId_ValuesThatRoundEqual_AreTheSameId()
    {
        var date = new DateOnly(2025, 9, 1);

        Assert.Equal(
            ImportIds.Measurement(ImportTestData.BabyId, date, 4.1m, null, null),
            ImportIds.Measurement(ImportTestData.BabyId, date, 4.100m, null, null));
    }
}
