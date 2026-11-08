using Lotties.Api.Demo;
using Lotties.Application.Demo;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Notifications;

namespace Lotties.Api.Tests.Demo;

public sealed class DemoUnitTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 6, 15, 30, 0, TimeSpan.Zero);

    [Fact]
    public void SampleData_IsDeterministic_AndNeverInTheFuture()
    {
        var babyId = Guid.Parse("11111111-2222-3333-4444-555555555555");

        var first = DemoSampleData.Build(babyId, Now);
        var second = DemoSampleData.Build(babyId, Now);

        Assert.True(first.Count > 100);
        Assert.Equal(first.Select(item => (item.Slot, item.Request.StartedAt, item.Request.EndedAt, item.Request.Payload.Value)), second.Select(item => (item.Slot, item.Request.StartedAt, item.Request.EndedAt, item.Request.Payload.Value)));
        Assert.All(first, item =>
        {
            // Every record is finished: an open end would show as a running timer in Now.
            Assert.NotNull(item.Request.EndedAt);
            Assert.True(item.Request.EndedAt <= Now);
            Assert.True(item.Request.StartedAt >= Now - TimeSpan.FromDays(DemoSampleData.Days));
        });
        Assert.NotEqual(first.Select(item => item.Request.StartedAt), DemoSampleData.Build(Guid.NewGuid(), Now).Select(item => item.Request.StartedAt));
    }

    [Fact]
    public void SampleData_IdsAreStableUniqueUuidV5()
    {
        var babyId = Guid.NewGuid();

        var ids = Enumerable.Range(-1, 400).Select(slot => DemoSampleData.EventId(babyId, slot)).ToArray();

        Assert.Equal(ids.Length, ids.Distinct().Count());
        Assert.Equal(ids, Enumerable.Range(-1, 400).Select(slot => DemoSampleData.EventId(babyId, slot)));
        Assert.All(ids, id => Assert.Equal('5', id.ToString()[14]));
        Assert.NotEqual(DemoSampleData.EventId(babyId, 1), DemoSampleData.EventId(Guid.NewGuid(), 1));
    }

    [Fact]
    public void Options_AreOffWithoutAKey_AndValidatedWhenSet()
    {
        var validator = new DemoOptionsValidator();

        Assert.False(new DemoOptions().IsEnabled);
        Assert.True(validator.Validate(null, new DemoOptions()).Succeeded);
        Assert.True(validator.Validate(null, new DemoOptions { SigningKey = new string('k', 32) }).Succeeded);
        Assert.True(validator.Validate(null, new DemoOptions { SigningKey = "short" }).Failed);
        Assert.True(validator.Validate(null, new DemoOptions { LifetimeDays = 0 }).Failed);
        Assert.True(validator.Validate(null, new DemoOptions { MaxLiveAccounts = 0 }).Failed);
        Assert.True(validator.Validate(null, new DemoOptions { StartPermitsPerHour = 0 }).Failed);
        Assert.Equal(TimeSpan.FromDays(3), new DemoOptions().Lifetime);
    }

    [Theory]
    [InlineData(null, 30, false)]
    [InlineData("k", 30, true)]
    [InlineData("k", 0, false)]
    public void CleanupService_RunsOnlyWhenTheDemoIsOnAndTheIntervalIsPositive(string? key, int minutes, bool expected) =>
        Assert.Equal(expected, DemoCleanupService.ShouldRun(new DemoOptions { SigningKey = key, CleanupMinutes = minutes }));

    [Fact]
    public void DemoUser_IsRecognisedByItsIssuer_AndForgetsTheExpiryWhenAnonymized()
    {
        var demo = User.CreateDemo("abc", "Demo visitor", Now, Now.AddDays(3));
        var real = User.Create("https://idp.example/realm", "abc", "Real", Now);

        Assert.True(demo.IsDemo);
        Assert.Equal(Now.AddDays(3), demo.DemoExpiresAt);
        Assert.False(real.IsDemo);
        Assert.Null(real.DemoExpiresAt);

        demo.Anonymize("Former member", Now);

        Assert.False(demo.IsDemo);
        Assert.Null(demo.DemoExpiresAt);
    }
}
