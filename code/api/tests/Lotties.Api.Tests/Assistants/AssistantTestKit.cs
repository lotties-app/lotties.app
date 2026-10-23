using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Lotties.Api.Authentication;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.Notifications;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// Runs the assistant command layer as a user, outside HTTP: a scope whose <see cref="IHttpContextAccessor"/> holds her
/// principal (what an adapter sets after authenticating her), so the real services, validators and SQLite database are used.
/// Fixtures go through the REST API (same rules) or the domain.
/// </summary>
internal static class AssistantTestKit
{
    public static AssistantInvocation Invocation(string? requestId = null, string? fallbackZone = null) =>
        new("test", requestId ?? $"req-{Guid.NewGuid():N}", fallbackZone);

    public static async Task<TResult> RunAsAsync<TResult>(this ApiFactory factory, string subject, Func<IAssistantService, Task<TResult>> work)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var accessor = scope.ServiceProvider.GetRequiredService<IHttpContextAccessor>();
        var identity = new ClaimsIdentity([new Claim(OidcClaims.Subject, subject)], "Test", OidcClaims.Name, null);
        accessor.HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity), RequestServices = scope.ServiceProvider };
        try
        {
            return await work(scope.ServiceProvider.GetRequiredService<IAssistantService>());
        }
        finally
        {
            accessor.HttpContext = null;
        }
    }

    /// <summary>Puts an event through the REST API as <paramref name="subject"/>; asserts it was stored.</summary>
    public static async Task<Guid> PutEventAsync(this ApiFactory factory, string subject, Guid babyId, Guid typeId, DateTimeOffset startedAt, DateTimeOffset? endedAt, string payload)
    {
        var id = Guid.NewGuid();
        var body = JsonSerializer.Serialize(new { typeId, startedAt, endedAt, payload = JsonDocument.Parse(payload).RootElement });
        var response = await factory.CreateClientFor(subject).PutAsync($"/api/v1/babies/{babyId}/events/{id}", new StringContent(body, Encoding.UTF8, "application/json"));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return id;
    }

    public static async Task<Guid> CreateBabyAsync(this ApiFactory factory, string subject, string name)
    {
        var response = await factory.CreateClientFor(subject).PostAsJsonAsync("/api/v1/babies", new { name, birthDate = DateTime.UtcNow.ToString("yyyy-MM-dd") });
        return (await response.ReadAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    public static Task<List<Event>> EventsAsync(this ApiFactory factory, Guid babyId) =>
        factory.QueryAsync(context => context.Events.AsNoTracking().Where(stored => stored.BabyId == babyId).ToListAsync());

    public static Task<Event> EventAsync(this ApiFactory factory, Guid eventId) =>
        factory.QueryAsync(context => context.Events.AsNoTracking().SingleAsync(stored => stored.Id == eventId));

    /// <summary>Stores the user's notification settings with <paramref name="zone"/> (where the assistants read her time zone).</summary>
    public static async Task SetTimeZoneAsync(this ApiFactory factory, string subject, string zone)
    {
        var userId = await factory.UserIdAsync(subject);
        await factory.SeedAsync(context =>
        {
            context.UserNotificationSettings.Add(UserNotificationSettings.Create(
                userId,
                new NotificationSettingsTerms(NotificationTimeZone.From(zone), QuietHours.Create(false, new TimeOnly(22, 0), new TimeOnly(7, 0)), false, false),
                DateTimeOffset.UtcNow));
            return Task.CompletedTask;
        });
    }

    /// <summary>A user who is a member of each baby with the given role (babies of a new owner each).</summary>
    public static async Task<(string Subject, Guid[] BabyIds)> SeedMemberOfAsync(this ApiFactory factory, params BabyRole[] roles)
    {
        var now = DateTimeOffset.UtcNow;
        var member = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Member", now);
        var babies = roles.Select((role, index) => (Role: role, Owner: User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", now), Name: $"Baby{index}")).ToArray();
        var created = babies.Select(entry =>
        {
            var baby = Baby.Create(entry.Name, DateOnly.FromDateTime(now.UtcDateTime), entry.Owner.Id, now);
            baby.AddMember(member.Id, entry.Role, now);
            return baby;
        }).ToArray();
        await factory.SeedAsync(context =>
        {
            context.Users.Add(member);
            context.Users.AddRange(babies.Select(entry => entry.Owner));
            context.Babies.AddRange(created);
            return Task.CompletedTask;
        });
        return (member.Subject, created.Select(baby => baby.Id).ToArray());
    }

    public static string Code(AssistantResult result) => AssistantResult.CodeName(result.Code);

    public static JsonElement PayloadOf(Event stored) => JsonDocument.Parse(stored.Payload.Value).RootElement;

    public static LottiesDbContext Context(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
}
