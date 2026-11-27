using System.Globalization;
using System.Security.Cryptography;
using Lotties.Api.Tests.Support;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>
/// Event loading of the community statistics job (docs/design/34-community-insights.md section 5.3) on the real API over SQLite:
/// the reading switch (off: no data-plane query at all, the placeholder as before; on: a release with statistics), the cap key (fail
/// closed, never logged), the population (only the snapshot's babies are read, re-checked; never a BYO, moving, demo, withdrawn or
/// old-text baby), the read itself (live events of the read types only), the population limit, failures, and end-to-end releases with
/// enough and too few families. Each test starts with no consent line, no stored release and a free lease, so only its own babies
/// are in the population.
/// </summary>
public sealed class CommunityEventLoadingTests(CommunityReadingApiFactory factory) : IClassFixture<CommunityReadingApiFactory>
{
    /// <summary>A Sunday in the fourth quarter of 2026: the percentile window is July to September 2026.</summary>
    private const string RunAt = "2026-11-29T03:30:00Z";

    private static readonly DateTimeOffset ConsentedAt = Parse("2026-06-01T12:00:00Z");

    private static readonly DateOnly BirthDate = new(2026, 5, 4);

    private static readonly DateTimeOffset BabyCreatedAt = Parse("2026-05-10T09:00:00Z");

    private static readonly DateOnly FirstLoggedDay = new(2026, 8, 3);

    private static readonly string ValidKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    // ── The switch ──────────────────────────────────────────────────────────

    [Fact]
    public async Task ReadingOff_WritesThePlaceholder_AndRunsNoQueryOnAnyDataPlaneTable()
    {
        await ResetAsync(readEvents: false);
        await SeedFamiliesAsync(3, babiesPerFamily: 1);

        await RunAsync(RunAt);

        var content = CommunityReleaseJson.Parse((await ActiveAsync()).StatisticsJson);
        Assert.True(content.IsPlaceholder);
        Assert.NotEmpty(factory.Sql.All);
        Assert.Empty(factory.Sql.DataPlane);
        Assert.Empty(factory.Source.Read);
    }

    /// <summary>The recorder of the test above does see data-plane queries: with reading on, the same babies are read.</summary>
    [Fact]
    public async Task ReadingOn_QueriesTheEventsOfTheEligibleBabies()
    {
        await ResetAsync(readEvents: true);
        var babies = await SeedFamiliesAsync(3, babiesPerFamily: 1);

        await RunAsync(RunAt);

        Assert.Contains(factory.Sql.DataPlane, command => command.Contains("\"events\"", StringComparison.Ordinal));
        Assert.Equal(babies.Order(), factory.Source.Read.Order());
        var content = CommunityReleaseJson.Parse((await ActiveAsync()).StatisticsJson);
        Assert.False(content.IsPlaceholder);
        Assert.NotEmpty(content.Statistics);
    }

    [Theory]
    [InlineData(null, "Missing")]
    [InlineData("   ", "Missing")]
    [InlineData("not base64 at all!", "NotBase64")]
    [InlineData("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", null)] // 32 bytes: valid, used as a control
    [InlineData("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHg==", "TooShort")] // 31 bytes
    public async Task ReadingOn_WithAnUnusableKey_ReadsNothing_WritesNothing_AndNeverLogsTheKey(string? key, string? problem)
    {
        await ResetAsync(readEvents: true, capKey: key);
        await SeedFamiliesAsync(2, babiesPerFamily: 1);
        await SeedReleaseAsync(CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(Parse("2026-08-02T03:30:00Z"), 2)), "2026-08-02T03:30:00Z");
        factory.Sql.Clear();

        await RunAsync(RunAt);
        var runSql = factory.Sql.All;

        if (problem is null)
        {
            Assert.Equal(2, (await StoredAsync()).Count);
            return;
        }

        Assert.Empty(runSql);
        Assert.Single(await StoredAsync());
        Assert.Empty(factory.Source.Read);
        Assert.Contains(factory.Logs.Lines, line => line.Contains($"CapKey is unusable ({problem};", StringComparison.Ordinal));
        Assert.DoesNotContain(factory.Logs.Lines, line => !string.IsNullOrWhiteSpace(key) && line.Contains(key.Trim()[..12], StringComparison.Ordinal));
    }

    /// <summary>A placeholder written while reading was off (or the phase-1 placeholder row) does not block the quarter's first real release.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task APlaceholderOfTheQuarter_DoesNotBlockTheFirstRealReleaseAfterTheSwitch(bool legacyRow)
    {
        await ResetAsync(readEvents: false);
        await SeedFamiliesAsync(3, babiesPerFamily: 1);
        if (legacyRow)
        {
            await SeedReleaseAsync("""{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}""", "2026-10-04T03:30:00Z");
        }
        else
        {
            await RunAsync("2026-10-04T03:30:00Z");
        }

        factory.Reading.ReadEvents = true;
        await RunAsync(RunAt);
        await RunAsync("2026-12-20T03:30:00Z");

        var stored = await StoredAsync();
        Assert.Equal(2, stored.Count);
        var active = await ActiveAsync();
        Assert.Equal(stored[^1].Id, active.Id);
        Assert.False(CommunityReleaseJson.Parse(active.StatisticsJson).IsPlaceholder);
        Assert.True(CommunityStoredRelease.Of(active.GeneratedAtUtc, active.StatisticsJson).CountsAgainstQuarter);
    }

    // ── Population ──────────────────────────────────────────────────────────

    public enum Excluded
    {
        NoConsent,
        Withdrawn,
        OldConsentText,
        DemoOwner,
        DeletedOwner,
        DemoMember,
        OwnDatabase,
        MovingIn,
    }

    [Theory]
    [InlineData(Excluded.NoConsent)]
    [InlineData(Excluded.Withdrawn)]
    [InlineData(Excluded.OldConsentText)]
    [InlineData(Excluded.DemoOwner)]
    [InlineData(Excluded.DeletedOwner)]
    [InlineData(Excluded.DemoMember)]
    [InlineData(Excluded.OwnDatabase)]
    [InlineData(Excluded.MovingIn)]
    public async Task OnlyEligibleBabiesAreRead(Excluded situation)
    {
        await ResetAsync(readEvents: true);
        var included = await SeedFamiliesAsync(1, babiesPerFamily: 1);
        var excluded = await SeedExcludedBabyAsync(situation);

        await RunAsync(RunAt);

        Assert.Equal(included, factory.Source.Read);
        Assert.DoesNotContain(excluded, factory.Source.Read);
    }

    [Fact]
    public async Task ReadAsync_ForABabyOnAnExternalStore_ReadsNothing()
    {
        var babyId = (await SeedFamiliesAsync(1, babiesPerFamily: 1, consent: false))[0];
        var ownerId = await OwnerOfAsync(babyId);
        await factory.AssignStoreAsync(babyId, ownerId, Guid.NewGuid());
        factory.Sql.Clear();

        var rows = await ReadDirectAsync(babyId, Parse("2026-06-02T00:00:00Z"), Parse("2026-11-29T00:00:00Z"));

        Assert.Null(rows);
        Assert.Empty(factory.Sql.DataPlane);
    }

    [Fact]
    public async Task ReadAsync_KeepsLiveEventsOfTheReadTypesInTheRange()
    {
        var babyId = (await SeedFamiliesAsync(1, babiesPerFamily: 1, consent: false, days: 0))[0];
        var ownerId = await OwnerOfAsync(babyId);
        var day = Parse("2026-08-10T00:00:00Z");
        var deleted = Bottle(babyId, ownerId, day.AddHours(9), 80);
        deleted.SoftDelete(day.AddHours(10));
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(
                Bottle(babyId, ownerId, day.AddHours(8), 100),
                deleted,
                Bottle(babyId, ownerId, Parse("2026-06-01T23:00:00Z"), 70),
                Bottle(babyId, ownerId, Parse("2026-11-29T01:00:00Z"), 60),
                Logged(babyId, ownerId, BuiltInEventTypes.MedicationId, day.AddHours(9), day.AddHours(9), """{"medications":[]}"""),
                Logged(babyId, ownerId, BuiltInEventTypes.TemperatureId, day.AddHours(9), day.AddHours(9), """{"value_c":37.5}"""));
            return Task.CompletedTask;
        });

        var rows = await ReadDirectAsync(babyId, Parse("2026-06-02T00:00:00Z"), Parse("2026-11-29T00:00:00Z"));

        Assert.NotNull(rows);
        Assert.Equal([100m], rows.Feeds.Select(feed => feed.FormulaDrunkMl!.Value));
        Assert.Empty(rows.Sleeps);
    }

    [Fact]
    public async Task Subjects_GroupBabiesOfOneOwnerInOneFamily_WithTheLatestConsentTime()
    {
        await ResetAsync(readEvents: true);
        var twins = await SeedFamiliesAsync(1, babiesPerFamily: 2, days: 0);
        var other = await SeedFamiliesAsync(1, babiesPerFamily: 1, days: 0);

        await using var scope = factory.Services.CreateAsyncScope();
        var subjects = await scope.ServiceProvider.GetRequiredService<ICommunityEventSource>()
            .SubjectsAsync([.. twins, .. other], CommunityConsentTexts.CurrentTextVersion);

        Assert.Equal(3, subjects.Count);
        Assert.Single(subjects.Where(subject => twins.Contains(subject.BabyId)).Select(subject => subject.FamilyId).Distinct());
        Assert.DoesNotContain(subjects.Single(subject => subject.BabyId == other[0]).FamilyId, subjects.Where(subject => twins.Contains(subject.BabyId)).Select(subject => subject.FamilyId));
        Assert.All(subjects, subject => Assert.Equal((BirthDate, ConsentedAt), (subject.BirthDate, subject.ConsentedAt)));
    }

    // ── Operation ───────────────────────────────────────────────────────────

    [Fact]
    public async Task APopulationAboveTheLimit_ReadsNothing_AndPublishesNothing()
    {
        await ResetAsync(readEvents: true, maxBabies: 2);
        await SeedFamiliesAsync(3, babiesPerFamily: 1);

        await RunAsync(RunAt);

        Assert.Empty(await StoredAsync());
        Assert.Empty(factory.Source.Read);
        Assert.Empty(factory.Sql.DataPlane);
        Assert.Contains(factory.Logs.Lines, line => line.Contains("exceed CommunityAggregation:MaxBabiesPerRun (2)", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AFailure_PublishesNothing_KeepsTheActiveRelease_AndLogsNoId()
    {
        await ResetAsync(readEvents: true);
        var babies = await SeedFamiliesAsync(2, babiesPerFamily: 1);
        await SeedReleaseAsync(CommunityReleaseJson.Serialize(CommunityRelease.Placeholder(Parse("2026-08-02T03:30:00Z"), 2)), "2026-08-02T03:30:00Z");
        factory.Source.Fail = true;

        try
        {
            await RunAsync(RunAt);
        }
        finally
        {
            factory.Source.Fail = false;
        }

        var stored = Assert.Single(await StoredAsync());
        Assert.Equal(CommunityStatisticsReleaseStatus.Active, stored.Status);
        Assert.Contains(factory.Logs.Lines, line => line.Contains("reading or aggregating failed (InvalidOperationException)", StringComparison.Ordinal));
        AssertNoIdInOurLogs(babies);
    }

    // ── End to end ──────────────────────────────────────────────────────────

    [Fact]
    public async Task EnoughFamilies_PublishAValidReleaseWithCells_WithNothingOfOneBabyInIt()
    {
        await ResetAsync(readEvents: true);
        var babies = await SeedFamiliesAsync(25, babiesPerFamily: 1);

        await RunAsync(RunAt);

        var active = await ActiveAsync();
        var release = CommunityReleaseJson.Parse(active.StatisticsJson);
        Assert.False(release.IsPlaceholder);
        Assert.Equal(25, factory.Source.Read.Count);
        Assert.Contains(release.Cells, cell => cell.Statistic == "tummy_minutes_per_day" && cell.Outputs.ContainsKey(CommunityOutputs.ShareOfDaysWithAny));
        Assert.Contains(release.Cells, cell => cell.Statistic == "bottle_ml_per_feed" && cell.Outputs.ContainsKey("p50"));
        Assert.Contains(release.Cells, cell => cell.Statistic == "night_sleep_minutes" && cell.Outputs.ContainsKey("p50"));
        Assert.All(release.Cells, cell => Assert.Equal(CommunityGroupSize.Babies20To49, cell.Babies));
        await AssertNothingOfOneBabyInAsync(active.StatisticsJson, babies);
        AssertNoIdInOurLogs(babies);
    }

    [Fact]
    public async Task TooFewFamilies_PublishAReleaseWithNoCell()
    {
        await ResetAsync(readEvents: true);
        await SeedFamiliesAsync(5, babiesPerFamily: 5);

        await RunAsync(RunAt);

        var release = CommunityReleaseJson.Parse((await ActiveAsync()).StatisticsJson);
        Assert.False(release.IsPlaceholder);
        Assert.NotEmpty(release.Statistics);
        Assert.Empty(release.Cells);
        Assert.Equal(25, factory.Source.Read.Count);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static DateTimeOffset Parse(string instant) => DateTimeOffset.Parse(instant, CultureInfo.InvariantCulture);

    private void AssertNoIdInOurLogs(IReadOnlyList<Guid> babies)
    {
        var ours = factory.Logs.Lines.Where(line => line.StartsWith("Lotties.", StringComparison.Ordinal)).ToArray();
        Assert.NotEmpty(ours);
        Assert.All(babies, baby => Assert.DoesNotContain(ours, line => line.Contains(baby.ToString(), StringComparison.OrdinalIgnoreCase) || line.Contains(baby.ToString("N"), StringComparison.OrdinalIgnoreCase)));
    }

    private async Task AssertNothingOfOneBabyInAsync(string json, IReadOnlyList<Guid> babies)
    {
        var owners = await factory.QueryAsync(context => context.BabyMembers.AsNoTracking().Where(member => babies.Contains(member.BabyId)).Select(member => member.UserId).ToListAsync());
        Assert.All(babies.Concat(owners), id => Assert.DoesNotContain(id.ToString(), json, StringComparison.OrdinalIgnoreCase));
        Assert.All(babies.Concat(owners), id => Assert.DoesNotContain(id.ToString("N"), json, StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("2026-08-", json, StringComparison.Ordinal);
        Assert.DoesNotContain("2026-05-04", json, StringComparison.Ordinal);
        Assert.DoesNotContain("formula", json, StringComparison.Ordinal);
    }

    /// <summary>One run of the job; the SQL and read recorders then hold only what that run did.</summary>
    private async Task RunAsync(string runAt)
    {
        factory.Source.Clear();
        factory.Sql.Clear();
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<CommunityAggregationRunner>().RunAsync(Guid.NewGuid(), Parse(runAt), CancellationToken.None);
    }

    private async Task<CommunityEventRows?> ReadDirectAsync(Guid babyId, DateTimeOffset from, DateTimeOffset before)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ICommunityEventSource>().ReadAsync(babyId, from, before);
    }

    private Task<CommunityStatisticsRelease> ActiveAsync() =>
        factory.QueryAsync(context => context.CommunityStatisticsReleases.AsNoTracking().SingleAsync(release => release.Status == CommunityStatisticsReleaseStatus.Active));

    private Task<List<CommunityStatisticsRelease>> StoredAsync() =>
        factory.QueryAsync(context => context.CommunityStatisticsReleases.AsNoTracking().OrderBy(release => release.ReleaseSequence).ToListAsync());

    private Task<Guid> OwnerOfAsync(Guid babyId) =>
        factory.QueryAsync(context => context.BabyMembers.AsNoTracking().Where(member => member.BabyId == babyId && member.Role == BabyRole.Owner).Select(member => member.UserId).SingleAsync());

    /// <summary>No consent line, no stored release, no community lease; the reading settings of the test; recorders emptied.</summary>
    private async Task ResetAsync(bool readEvents, string? capKey = "", int maxBabies = 0)
    {
        factory.Reading.ReadEvents = readEvents;
        factory.Reading.CapKey = capKey == string.Empty ? ValidKey : capKey;
        factory.Reading.MaxBabiesPerRun = maxBabies;
        factory.Source.Fail = false;
        await factory.SeedAsync(async context =>
        {
            context.CommunityConsents.RemoveRange(await context.CommunityConsents.ToListAsync());
            context.CommunityStatisticsReleases.RemoveRange(await context.CommunityStatisticsReleases.ToListAsync());
            context.JobLeases.RemoveRange(await context.JobLeases.Where(lease => lease.Name == Lotties.Domain.Notifications.JobLease.CommunityAggregationName).ToListAsync());
        });
        factory.Sql.Clear();
        factory.Source.Clear();
    }

    private Task SeedReleaseAsync(string json, string generatedAt) =>
        factory.SeedAsync(context =>
        {
            var release = CommunityStatisticsRelease.CreatePending("seeded", 1, json, Parse(generatedAt));
            release.Activate();
            context.CommunityStatisticsReleases.Add(release);
            return Task.CompletedTask;
        });

    /// <summary>
    /// <paramref name="families"/> Owners with <paramref name="babiesPerFamily"/> babies each, born on <see cref="BirthDate"/>, with a
    /// current consent at <see cref="ConsentedAt"/> (unless <paramref name="consent"/> is false) and <paramref name="days"/> logged days
    /// from <see cref="FirstLoggedDay"/>.
    /// </summary>
    private async Task<IReadOnlyList<Guid>> SeedFamiliesAsync(int families, int babiesPerFamily, bool consent = true, int days = 20)
    {
        var babies = new List<Guid>();
        for (var family = 0; family < families; family++)
        {
            var owner = User.Create("https://issuer.test", TestUsers.NewSubject(), "Owner", TestUsers.Now);
            var created = Enumerable.Range(0, babiesPerFamily).Select(_ => Baby.Create(null, BirthDate, owner.Id, BabyCreatedAt)).ToArray();
            await factory.SeedAsync(context =>
            {
                context.Users.Add(owner);
                context.Babies.AddRange(created);
                context.CommunityConsents.AddRange(consent ? created.Select(baby => Grant(baby.Id, owner.Id)) : []);
                context.Events.AddRange(created.SelectMany(baby => LoggedDays(baby.Id, owner.Id, days)));
                return Task.CompletedTask;
            });
            babies.AddRange(created.Select(baby => baby.Id));
        }

        return babies;
    }

    private async Task<Guid> SeedExcludedBabyAsync(Excluded situation)
    {
        var owner = situation switch
        {
            Excluded.DemoOwner => User.CreateDemo(TestUsers.NewSubject(), "Demo", TestUsers.Now, TestUsers.Now.AddYears(5)),
            _ => User.Create("https://issuer.test", TestUsers.NewSubject(), "Owner", TestUsers.Now),
        };
        if (situation == Excluded.DeletedOwner)
        {
            owner.Anonymize("Deleted account", TestUsers.Now);
        }

        var baby = Baby.Create(null, BirthDate, owner.Id, BabyCreatedAt);
        var demo = User.CreateDemo(TestUsers.NewSubject(), "Demo", TestUsers.Now, TestUsers.Now.AddYears(5));
        if (situation == Excluded.DemoMember)
        {
            baby.AddMember(demo.Id, BabyRole.Viewer, TestUsers.Now);
        }

        await factory.SeedAsync(context =>
        {
            context.Users.AddRange(owner, demo);
            context.Babies.Add(baby);
            context.CommunityConsents.AddRange(ConsentLinesFor(situation, baby.Id, owner.Id));
            context.Events.AddRange(LoggedDays(baby.Id, owner.Id, 20));
            return Task.CompletedTask;
        });
        await PlaceAsync(situation, baby.Id, owner.Id);
        return baby.Id;
    }

    private static IEnumerable<CommunityConsentEntry> ConsentLinesFor(Excluded situation, Guid babyId, Guid ownerId) => situation switch
    {
        Excluded.NoConsent => [],
        Excluded.Withdrawn => [Grant(babyId, ownerId), CommunityConsentEntry.Withdraw(babyId, ownerId, "test-policy", "en", ConsentedAt.AddDays(30))],
        Excluded.OldConsentText => [CommunityConsentEntry.Rehydrate(Guid.NewGuid(), babyId, ownerId, CommunityConsentAction.Granted, "ci-1", "test-policy", ["all"], true, "en", ConsentedAt)],
        _ => [Grant(babyId, ownerId)],
    };

    private Task PlaceAsync(Excluded situation, Guid babyId, Guid ownerId) => situation switch
    {
        Excluded.OwnDatabase => factory.AssignStoreAsync(babyId, ownerId, Guid.NewGuid()),
        Excluded.MovingIn => factory.SeedAsync(context =>
        {
            var storeId = Guid.NewGuid();
            context.DataStores.Add(DataStore.Create(storeId, ownerId, TestUsers.Now));
            context.DataStoreMoves.Add(DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, "worker", TestUsers.Now, TimeSpan.FromMinutes(5)));
            return Task.CompletedTask;
        }),
        _ => Task.CompletedTask,
    };

    private static CommunityConsentEntry Grant(Guid babyId, Guid ownerId) =>
        CommunityConsentEntry.Grant(babyId, ownerId, CommunityConsentTexts.CurrentTextVersion, true, "test-policy", "en", ConsentedAt);

    /// <summary>
    /// <paramref name="days"/> days of a regular routine from <see cref="FirstLoggedDay"/>: a formula bottle (120 ml made, 100 drunk), a
    /// one-hour nap, a night from 20:00 to 06:00, an answered crying spell, and tummy time every other day; plus a note on the bottle.
    /// </summary>
    private static IEnumerable<Event> LoggedDays(Guid babyId, Guid ownerId, int days) =>
        Enumerable.Range(0, days).Select(FirstLoggedDay.AddDays).SelectMany((day, index) =>
        {
            var midnight = new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var logged = new List<Event>
            {
                Bottle(babyId, ownerId, midnight.AddHours(8), 100),
                Logged(babyId, ownerId, BuiltInEventTypes.SleepId, midnight.AddHours(13), midnight.AddHours(14), """{"kind":"nap"}"""),
                Logged(babyId, ownerId, BuiltInEventTypes.SleepId, midnight.AddHours(20), midnight.AddHours(30), """{"kind":"night"}"""),
                Logged(babyId, ownerId, BuiltInEventTypes.FussyId, midnight.AddHours(18), midnight.AddHours(18).AddMinutes(20), """{"what_helped":"feeding"}"""),
            };
            if (index % 2 == 0)
            {
                logged.Add(Logged(babyId, ownerId, BuiltInEventTypes.TummyTimeId, midnight.AddHours(10), midnight.AddHours(10).AddMinutes(15), """{"mood":"happy"}"""));
            }

            return logged;
        });

    private static Event Bottle(Guid babyId, Guid ownerId, DateTimeOffset at, int drunkMl) =>
        Event.Create(
            Guid.NewGuid(),
            babyId,
            BuiltInEventTypes.FeedingId,
            ownerId,
            at,
            at,
            EventPayload.From($$"""{"method":"bottle","bottle_feeding_type":"formula","amount_ml":120,"amount_drunk_ml":{{drunkMl}},"formula_name":"Brand X"}"""),
            "a note that must never be read",
            at);

    private static Event Logged(Guid babyId, Guid ownerId, Guid typeId, DateTimeOffset start, DateTimeOffset end, string payload) =>
        Event.Create(Guid.NewGuid(), babyId, typeId, ownerId, start, end, EventPayload.From(payload), null, start);
}
