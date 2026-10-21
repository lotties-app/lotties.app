using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Medications;
using BabyRoutine.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Api.Tests.Persistence;

/// <summary>Repository behavior against the SQLite test database, which enforces the same unique indexes as PostgreSQL.</summary>
public sealed class RepositoryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task AddOrGetExistingAsync_NewSubject_SavesAndReturnsUser()
    {
        var user = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Ana", TestUsers.Now);

        var saved = await WithUsersAsync(users => users.AddOrGetExistingAsync(user));

        Assert.Same(user, saved);
        Assert.True(await factory.QueryAsync(context => context.Users.AnyAsync(stored => stored.Id == user.Id)));
    }

    [Fact]
    public async Task AddOrGetExistingAsync_SubjectInsertedConcurrently_ReturnsWinnerAndKeepsOneRow()
    {
        var subject = TestUsers.NewSubject();
        var winner = User.Create(User.UnknownIssuer, subject, "Winner", TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(winner);
            return Task.CompletedTask;
        });

        var resolved = await WithUsersAsync(users => users.AddOrGetExistingAsync(User.Create(User.UnknownIssuer, subject, "Loser", TestUsers.Now)));

        Assert.Equal(winner.Id, resolved.Id);
        Assert.Equal(1, await factory.QueryAsync(context => context.Users.CountAsync(stored => stored.Subject == subject)));
    }

    [Fact]
    public async Task MedicationTryAddAsync_SameIdInsertedFirst_ReturnsFalse()
    {
        var baby = await factory.SeedBabyAsync();
        var winner = Medication.Create(Guid.NewGuid(), baby.BabyId, "Colidis", null, null, isUsual: false, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Medications.Add(winner);
            return Task.CompletedTask;
        });

        var added = await WithMedicationsAsync(medications => medications.TryAddAsync(Medication.Create(winner.Id, baby.BabyId, "Loser", null, null, isUsual: false, TestUsers.Now)));

        Assert.False(added);
    }

    [Fact]
    public async Task MedicationTryAddAsync_DatabaseErrorOtherThanUniqueViolation_Rethrows()
    {
        var orphan = Medication.Create(Guid.NewGuid(), Guid.NewGuid(), "Colidis", null, null, isUsual: false, TestUsers.Now);

        await Assert.ThrowsAsync<DbUpdateException>(() => WithMedicationsAsync(medications => medications.TryAddAsync(orphan)));
    }

    [Fact]
    public async Task FindByIdentityAsync_UnknownSubject_ReturnsNull()
    {
        Assert.Null(await WithUsersAsync(users => users.FindByIdentityAsync(User.UnknownIssuer, TestUsers.NewSubject())));
    }

    [Fact]
    public async Task FindByIdentityAsync_SameSubjectOtherIssuer_ReturnsNull()
    {
        var user = User.Create("https://a.example.test/", TestUsers.NewSubject(), "Ana", TestUsers.Now);
        await WithUsersAsync(users => users.AddOrGetExistingAsync(user));

        Assert.Null(await WithUsersAsync(users => users.FindByIdentityAsync("https://b.example.test/", user.Subject)));
        Assert.Equal(user.Id, (await WithUsersAsync(users => users.FindByIdentityAsync("https://a.example.test/", user.Subject)))!.Id);
    }

    [Fact]
    public async Task MembershipFindAsync_Member_ReturnsMembershipWithRole()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var viewerId = await UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var member = await WithMembershipsAsync(memberships => memberships.FindAsync(baby.BabyId, viewerId));

        Assert.Equal(BabyRole.Viewer, member!.Role);
    }

    [Fact]
    public async Task MembershipFindAsync_NonMember_ReturnsNull()
    {
        var baby = await factory.SeedBabyAsync();

        Assert.Null(await WithMembershipsAsync(memberships => memberships.FindAsync(baby.BabyId, Guid.NewGuid())));
    }

    [Fact]
    public async Task InviteRemoveAsync_InviteDeletedConcurrently_IsANoOp()
    {
        var (baby, invite) = await SeedInviteAsync();
        await using var scope = factory.Services.CreateAsyncScope();
        var invites = scope.ServiceProvider.GetRequiredService<IInviteRepository>();
        var tracked = await invites.FindForBabyAsync(baby.BabyId, invite.Id);
        await factory.SeedAsync(async context => context.Invites.Remove(await context.InviteAsync(invite.Id)));

        await invites.RemoveAsync(tracked!);

        Assert.False(await factory.QueryAsync(context => context.Invites.AnyAsync(stored => stored.Id == invite.Id)));
    }

    [Fact]
    public async Task InviteRemoveAsync_InviteAcceptedConcurrently_ThrowsAlreadyAcceptedAndKeepsIt()
    {
        var (baby, invite) = await SeedInviteAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        await using var scope = factory.Services.CreateAsyncScope();
        var invites = scope.ServiceProvider.GetRequiredService<IInviteRepository>();
        var tracked = await invites.FindForBabyAsync(baby.BabyId, invite.Id);
        await factory.SeedAsync(async context =>
        {
            var stored = await context.InviteAsync(invite.Id);
            stored.Accept(ownerId, TestUsers.Now);
            context.BumpRowVersion(stored);
        });

        await Assert.ThrowsAsync<InviteAlreadyAcceptedException>(() => invites.RemoveAsync(tracked!));

        Assert.True(await factory.QueryAsync(context => context.Invites.AnyAsync(stored => stored.Id == invite.Id)));
    }

    private async Task<(SeededBaby Baby, Invite Invite)> SeedInviteAsync()
    {
        var baby = await factory.SeedBabyAsync();
        var invite = Invite.Issue(baby.BabyId, BabyRole.Parent, await UserIdAsync(baby.OwnerSubject), DateTimeOffset.UtcNow, TimeSpan.FromDays(1)).Invite;
        await factory.SeedAsync(context =>
        {
            context.Invites.Add(invite);
            return Task.CompletedTask;
        });
        return (baby, invite);
    }

    private Task<Guid> UserIdAsync(string subject) =>
        factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).Select(user => user.Id).SingleAsync());

    private async Task<TResult> WithUsersAsync<TResult>(Func<IUserRepository, Task<TResult>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IUserRepository>());
    }

    private async Task<TResult> WithMedicationsAsync<TResult>(Func<IMedicationRepository, Task<TResult>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IMedicationRepository>());
    }

    private async Task<TResult> WithMembershipsAsync<TResult>(Func<IBabyMembershipRepository, Task<TResult>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IBabyMembershipRepository>());
    }
}
