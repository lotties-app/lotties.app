using Lotties.Api.Tests.Support;
using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Backups;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Persistence;

/// <summary>
/// The control and data contexts on the built-in database (docs/design/47-bring-your-own-database.md, task T1): one database,
/// one connection per scope, so both see the same rows and a shared transaction holds writes of both planes.
/// </summary>
public sealed class PlaneContextsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task BothContexts_SeeTheSameRows()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var throughControl = NewEvent(baby.BabyId, ownerId);
        var throughData = NewEvent(baby.BabyId, ownerId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var control = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
            var data = scope.ServiceProvider.GetRequiredService<LottiesDataDbContext>();
            Assert.Same(control.Database.GetDbConnection(), data.Database.GetDbConnection());
            control.Events.Add(throughControl);
            await control.SaveChangesAsync();
            data.Events.Add(throughData);
            await data.SaveChangesAsync();
        }

        await using var reader = factory.Services.CreateAsyncScope();
        Assert.Equal(
            await IdsAsync(reader.ServiceProvider.GetRequiredService<LottiesDbContext>().Events, baby.BabyId),
            await IdsAsync(reader.ServiceProvider.GetRequiredService<LottiesDataDbContext>().Events, baby.BabyId));
        Assert.Equal(new[] { throughControl.Id, throughData.Id }.Order(), await IdsAsync(reader.ServiceProvider.GetRequiredService<LottiesDataDbContext>().Events, baby.BabyId));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task BackupSession_CommitsOrRollsBackBothPlanesTogether(bool commit)
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            return Task.CompletedTask;
        });
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), owner.Id, TestUsers.Now);
        var entry = NewEvent(baby.Id, owner.Id);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var session = scope.ServiceProvider.GetRequiredService<IBackupSession>();
            await scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(baby.Id);
            await session.BeginAsync();
            await scope.ServiceProvider.GetRequiredService<IBabyRepository>().AddAsync(baby);
            await scope.ServiceProvider.GetRequiredService<IEventRepository>().TryAddAsync(entry);
            await (commit ? session.CommitAsync() : session.RollbackAsync());
        }

        Assert.Equal(commit, await factory.QueryAsync(context => context.Babies.AnyAsync(stored => stored.Id == baby.Id)));
        Assert.Equal(commit, await factory.QueryAsync(context => context.Events.AnyAsync(stored => stored.Id == entry.Id)));
    }

    [Fact]
    public async Task SavingOnePlane_WhileTheOtherHasChanges_FailsInTheTestHost()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        await using var scope = factory.Services.CreateAsyncScope();
        var control = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        var data = scope.ServiceProvider.GetRequiredService<LottiesDataDbContext>();

        data.Events.Add(NewEvent(baby.BabyId, ownerId));
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => control.SaveChangesAsync());

        Assert.Contains("BuiltInUnitOfWork", error.Message, StringComparison.Ordinal);
    }

    private static Event NewEvent(Guid babyId, Guid createdBy) =>
        Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.DiaperId, createdBy, TestUsers.Now, TestUsers.Now, EventPayload.From("""{"content":"WET"}"""), null, TestUsers.Now);

    private static async Task<Guid[]> IdsAsync(IQueryable<Event> events, Guid babyId) =>
        (await events.Where(item => item.BabyId == babyId).Select(item => item.Id).ToListAsync()).Order().ToArray();
}
