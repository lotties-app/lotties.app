using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Api.Tests.Support;

internal static class TestUsers
{
    public static readonly DateTimeOffset Now = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);

    public static string NewSubject() => $"test|{Guid.NewGuid():N}";

    public static HttpClient CreateClientFor(this ApiFactory factory, string subject, string? name = null, string? email = null)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        AddIfPresent(client, TestAuthHandler.NameHeader, name);
        AddIfPresent(client, TestAuthHandler.EmailHeader, email);
        return client;
    }

    /// <summary>Seeds a baby whose owner is a new user, plus one user per <paramref name="memberRoles"/> entry.</summary>
    public static async Task<SeededBaby> SeedBabyAsync(this ApiFactory factory, params BabyRole[] memberRoles)
    {
        var owner = User.Create(NewSubject(), "Owner", Now);
        var members = memberRoles.Select(role => (Role: role, User: User.Create(NewSubject(), role.ToString(), Now))).ToArray();
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(Now.UtcDateTime), owner.Id, Now);
        Array.ForEach(members, member => baby.AddMember(member.User.Id, member.Role, Now));
        await factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Users.AddRange(members.Select(member => member.User));
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        return new SeededBaby(baby.Id, owner.Subject, members.ToDictionary(member => member.Role, member => member.User.Subject));
    }

    private static void AddIfPresent(HttpClient client, string header, string? value)
    {
        if (value is not null)
        {
            client.DefaultRequestHeaders.Add(header, value);
        }
    }
}

internal sealed record SeededBaby(Guid BabyId, string OwnerSubject, IReadOnlyDictionary<BabyRole, string> MemberSubjects)
{
    public string SubjectOf(BabyRole role) => role == BabyRole.Owner ? OwnerSubject : MemberSubjects[role];
}
