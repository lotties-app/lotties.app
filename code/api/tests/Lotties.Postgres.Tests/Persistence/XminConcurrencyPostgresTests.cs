using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Lotties.Postgres.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Postgres.Tests.Persistence;

/// <summary>
/// The <c>xmin</c> row versions (<c>RowVersions.HasXminRowVersion</c> on babies, invites, data stores, proposals, job leases) on a
/// real Postgres, which the SQLite test host cannot check: a write bumps the system column, a second unit of work that read the row
/// before fails with <see cref="DbUpdateConcurrencyException"/>, and the baby repository turns that into the domain outcome its
/// contract names (<see cref="IBabyRepository.SaveChangesAsync"/>).
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class XminConcurrencyPostgresTests(PostgresFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 11, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly BirthDate = new(2026, 8, 1);

    [PostgresFact]
    public async Task Second_writer_of_a_baby_read_before_the_first_save_gets_a_concurrency_exception()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "xminbaby");
        var (_, babyId) = await AddFamilyAsync(world);
        await using var first = world.NewContext();
        await using var second = world.NewContext();
        var firstCopy = await first.Babies.SingleAsync(baby => baby.Id == babyId);
        var secondCopy = await second.Babies.SingleAsync(baby => baby.Id == babyId);
        var versionRead = first.Entry(firstCopy).Property<uint>("Version").CurrentValue;

        firstCopy.UpdateDetails("First", BirthDate, Now);
        await first.SaveChangesAsync();
        secondCopy.UpdateDetails("Second", BirthDate, Now);

        var conflict = await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
        Assert.Same(secondCopy, Assert.Single(conflict.Entries).Entity);
        Assert.NotEqual(versionRead, first.Entry(firstCopy).Property<uint>("Version").CurrentValue);
        Assert.Equal("First", await postgres.ScalarAsync<string>($"SELECT name FROM babies WHERE id = '{babyId}'", world.Database));
    }

    [PostgresFact]
    public async Task Writer_that_read_after_the_first_save_is_not_a_conflict()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "xminseq");
        var (_, babyId) = await AddFamilyAsync(world);

        await using (var first = world.NewContext())
        {
            (await first.Babies.SingleAsync(baby => baby.Id == babyId)).UpdateDetails("First", BirthDate, Now);
            await first.SaveChangesAsync();
        }

        await using var second = world.NewContext();
        (await second.Babies.SingleAsync(baby => baby.Id == babyId)).UpdateDetails("Second", BirthDate, Now);
        await second.SaveChangesAsync();

        Assert.Equal("Second", await postgres.ScalarAsync<string>($"SELECT name FROM babies WHERE id = '{babyId}'", world.Database));
    }

    [PostgresFact]
    public async Task Concurrent_member_changes_through_the_repository_leave_one_and_report_concurrent_modification()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "xminmembers");
        var (ownerId, babyId) = await AddFamilyAsync(world);
        var firstParent = await AddUserAsync(world, "First parent");
        var secondParent = await AddUserAsync(world, "Second parent");
        await using var firstScope = world.Scope(ownerId);
        await using var secondScope = world.Scope(ownerId);
        var firstBabies = firstScope.ServiceProvider.GetRequiredService<IBabyRepository>();
        var secondBabies = secondScope.ServiceProvider.GetRequiredService<IBabyRepository>();
        var firstCopy = (await firstBabies.FindAsync(babyId))!;
        var secondCopy = (await secondBabies.FindAsync(babyId))!;

        firstCopy.AddMember(firstParent, BabyRole.Parent, Now);
        await firstBabies.SaveChangesAsync();
        secondCopy.AddMember(secondParent, BabyRole.Parent, Now);

        var conflict = await Assert.ThrowsAsync<ConcurrentModificationException>(() => secondBabies.SaveChangesAsync());
        Assert.Equal("concurrent_modification", conflict.Code);
        Assert.Equal(
            new[] { ownerId, firstParent }.Order(),
            await MemberIdsAsync(world, babyId));
    }

    /// <remarks>
    /// Current behavior on Postgres: the losing save fails on the baby row first (EF writes it before the invite and Npgsql reports
    /// only that entry), so the loser gets <see cref="ConcurrentModificationException"/>, not the
    /// <see cref="InviteAlreadyAcceptedException"/> that <see cref="IBabyRepository.SaveChangesAsync"/> and <c>IInviteService.AcceptAsync</c>
    /// document; the retry it asks for then gets <see cref="InviteAlreadyAcceptedException"/>. Nothing of the loser is saved.
    /// </remarks>
    [PostgresFact]
    public async Task Same_invite_accepted_twice_admits_the_first_and_the_second_learns_it_was_accepted_on_retry()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "xmininvite");
        var (ownerId, babyId) = await AddFamilyAsync(world);
        var firstGuest = await AddUserAsync(world, "First guest");
        var secondGuest = await AddUserAsync(world, "Second guest");
        var inviteId = await IssueInviteAsync(world, ownerId, babyId);
        await using var firstScope = world.Scope(firstGuest);
        await using var secondScope = world.Scope(secondGuest);
        var first = await LoadForAcceptAsync(firstScope, babyId, inviteId);
        var second = await LoadForAcceptAsync(secondScope, babyId, inviteId);

        first.Baby.AdmitWith(first.Invite, firstGuest, Now.AddMinutes(1));
        await first.Babies.SaveChangesAsync();
        second.Baby.AdmitWith(second.Invite, secondGuest, Now.AddMinutes(2));

        await Assert.ThrowsAsync<ConcurrentModificationException>(() => second.Babies.SaveChangesAsync());
        await using var retryScope = world.Scope(secondGuest);
        var retry = await LoadForAcceptAsync(retryScope, babyId, inviteId);
        Assert.Throws<InviteAlreadyAcceptedException>(() => retry.Baby.AdmitWith(retry.Invite, secondGuest, Now.AddMinutes(3)));

        Assert.Equal(new[] { ownerId, firstGuest }.Order(), await MemberIdsAsync(world, babyId));
        Assert.Equal(firstGuest, await postgres.ScalarAsync<Guid>($"SELECT accepted_by FROM invites WHERE id = '{inviteId}'", world.Database));
    }

    private static async Task<(Guid OwnerId, Guid BabyId)> AddFamilyAsync(BuiltInWorld world)
    {
        await using var context = world.NewContext();
        var owner = User.Create(User.UnknownIssuer, $"xmin|{Guid.NewGuid():N}", "Owner", Now);
        var baby = Baby.Create("Lia", BirthDate, owner.Id, Now);
        context.Users.Add(owner);
        context.Babies.Add(baby);
        await context.SaveChangesAsync();
        return (owner.Id, baby.Id);
    }

    private static async Task<Guid> AddUserAsync(BuiltInWorld world, string name)
    {
        await using var context = world.NewContext();
        var user = User.Create(User.UnknownIssuer, $"xmin|{Guid.NewGuid():N}", name, Now);
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user.Id;
    }

    private static async Task<Guid> IssueInviteAsync(BuiltInWorld world, Guid ownerId, Guid babyId)
    {
        await using var context = world.NewContext();
        var issued = Invite.Issue(babyId, BabyRole.Parent, ownerId, Now, TimeSpan.FromDays(7));
        context.Invites.Add(issued.Invite);
        await context.SaveChangesAsync();
        return issued.Invite.Id;
    }

    private static async Task<Accepting> LoadForAcceptAsync(AsyncServiceScope scope, Guid babyId, Guid inviteId)
    {
        var babies = scope.ServiceProvider.GetRequiredService<IBabyRepository>();
        var invites = scope.ServiceProvider.GetRequiredService<IInviteRepository>();
        var baby = (await babies.FindAsync(babyId))!;
        var invite = (await invites.FindForBabyAsync(babyId, inviteId))!;
        return new Accepting(babies, baby, invite);
    }

    private static async Task<IEnumerable<Guid>> MemberIdsAsync(BuiltInWorld world, Guid babyId)
    {
        await using var context = world.NewContext();
        var ids = await context.BabyMembers.Where(member => member.BabyId == babyId).Select(member => member.UserId).ToListAsync();
        return ids.Order();
    }

    private sealed record Accepting(IBabyRepository Babies, Baby Baby, Invite Invite);
}
