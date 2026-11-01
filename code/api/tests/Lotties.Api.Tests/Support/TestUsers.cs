using Lotties.Domain.Babies;
using Lotties.Domain.Users;

namespace Lotties.Api.Tests.Support;

internal static class TestUsers
{
    public static readonly DateTimeOffset Now = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);

    public static string NewSubject() => $"test|{Guid.NewGuid():N}";

    public static HttpClient CreateClientFor(
        this ApiFactory factory,
        string subject,
        string? name = null,
        string? email = null,
        string? issuer = null,
        string? preferredUsername = null,
        string? nickname = null)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        AddIfPresent(client, TestAuthHandler.NameHeader, name);
        AddIfPresent(client, TestAuthHandler.EmailHeader, email);
        AddIfPresent(client, TestAuthHandler.IssuerHeader, issuer);
        AddIfPresent(client, TestAuthHandler.PreferredUsernameHeader, preferredUsername);
        AddIfPresent(client, TestAuthHandler.NicknameHeader, nickname);
        return client;
    }

    /// <summary>Seeds a baby whose owner is a new user, plus one user per <paramref name="memberRoles"/> entry.</summary>
    public static Task<SeededBaby> SeedBabyAsync(this ApiFactory factory, params BabyRole[] memberRoles) =>
        factory.SeedBabyAsync(doctorScopes: null, memberRoles);

    /// <summary>
    /// Seeds a baby like <see cref="SeedBabyAsync(ApiFactory, BabyRole[])"/>, with every Doctor member limited to
    /// <paramref name="doctorScopes"/> through the domain (<see cref="Baby.ChangeDoctorScopes"/>); <c>null</c> keeps the defaults.
    /// </summary>
    public static async Task<SeededBaby> SeedBabyAsync(this ApiFactory factory, DoctorScopeSet? doctorScopes, params BabyRole[] memberRoles)
    {
        var owner = User.Create(User.UnknownIssuer, NewSubject(), "Owner", Now);
        var members = memberRoles.Select(role => (Role: role, User: User.Create(User.UnknownIssuer, NewSubject(), role.ToString(), Now))).ToArray();
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(Now.UtcDateTime), owner.Id, Now);
        Array.ForEach(members, member => baby.AddMember(member.User.Id, member.Role, Now));
        if (doctorScopes is not null)
        {
            Array.ForEach(members.Where(member => member.Role == BabyRole.Doctor).ToArray(), member => baby.ChangeDoctorScopes(member.User.Id, doctorScopes));
        }

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
