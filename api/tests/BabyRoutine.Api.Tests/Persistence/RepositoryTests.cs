using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Domain.Babies;
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
        var user = User.Create(TestUsers.NewSubject(), "Ana", TestUsers.Now);

        var saved = await WithUsersAsync(users => users.AddOrGetExistingAsync(user));

        Assert.Same(user, saved);
        Assert.True(await factory.QueryAsync(context => context.Users.AnyAsync(stored => stored.Id == user.Id)));
    }

    [Fact]
    public async Task AddOrGetExistingAsync_SubjectInsertedConcurrently_ReturnsWinnerAndKeepsOneRow()
    {
        var subject = TestUsers.NewSubject();
        var winner = User.Create(subject, "Winner", TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(winner);
            return Task.CompletedTask;
        });

        var resolved = await WithUsersAsync(users => users.AddOrGetExistingAsync(User.Create(subject, "Loser", TestUsers.Now)));

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
    public async Task FindBySubjectAsync_UnknownSubject_ReturnsNull()
    {
        Assert.Null(await WithUsersAsync(users => users.FindBySubjectAsync(TestUsers.NewSubject())));
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
