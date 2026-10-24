using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Board;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using Lotties.Domain.Users;

namespace Lotties.Api.Tests.Board;

/// <summary>Clients and fixtures of the project board tests (docs/design/36-project-board.md).</summary>
internal static class BoardTestKit
{
    public const string Path = "/api/v1/board";
    public const string Reader = BoardClaims.ReaderRole;
    public const string Writer = BoardClaims.WriterRole;
    public const string Admin = BoardClaims.AdminRole;

    /// <summary>A signed-in user with the given Keycloak realm roles (none: a user without a board role).</summary>
    public static HttpClient BoardUser(this ApiFactory factory, string? roles, string? subject = null, string name = "Owner Person")
    {
        var client = factory.CreateClientFor(subject ?? TestUsers.NewSubject(), name);
        if (roles is not null)
        {
            client.DefaultRequestHeaders.Add(TestAuthHandler.RealmRolesHeader, roles);
        }

        return client;
    }

    /// <summary>An anonymous client that presents <paramref name="secret"/> as a bearer token, or in <c>X-Board-Key</c>.</summary>
    public static HttpClient KeyClient(this ApiFactory factory, string secret, bool inHeader = false)
    {
        var client = factory.CreateClient();
        if (inHeader)
        {
            client.DefaultRequestHeaders.Add(BoardKeyAuthenticationHandler.HeaderName, secret);
        }
        else
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", secret);
        }

        return client;
    }

    /// <summary>Seeds a key (created by a new admin user) straight in the database; returns its secret.</summary>
    public static async Task<string> SeedKeyAsync(
        this ApiFactory factory,
        BoardKeyScope scope,
        IReadOnlyList<string>? topics = null,
        bool revoked = false,
        bool expired = false,
        string name = "Claude test key")
    {
        var creator = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Key Admin", TestUsers.Now);
        var now = expired ? DateTimeOffset.UtcNow.AddDays(-10) : DateTimeOffset.UtcNow;
        var (key, secret) = BoardApiKey.Create(name, scope, topics, expired ? now.AddDays(1) : null, BoardActor.ForUser(creator.Id, creator.DisplayName), now);
        if (revoked)
        {
            key.Revoke(now);
        }

        await factory.SeedAsync(context =>
        {
            context.Users.Add(creator);
            context.BoardApiKeys.Add(key);
            return Task.CompletedTask;
        });
        return secret;
    }

    /// <summary>A create body; <paramref name="extra"/> adds or overrides properties.</summary>
    public static Dictionary<string, object?> Item(string title, string topic = "product", string type = "task", params (string Name, object? Value)[] extra)
    {
        var body = new Dictionary<string, object?> { ["type"] = type, ["topic"] = topic, ["title"] = title };
        foreach (var (name, value) in extra)
        {
            body[name] = value;
        }

        return body;
    }

    public static async Task<JsonElement> CreateAsync(this HttpClient client, Dictionary<string, object?> body) =>
        await (await client.PostAsJsonAsync($"{Path}/items", body)).ReadAsync<JsonElement>();

    public static Task<HttpResponseMessage> PatchAsync(this HttpClient client, Guid id, object body, int? ifMatch = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, $"{Path}/items/{id}") { Content = JsonContent.Create(body) };
        if (ifMatch is { } version)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        }

        return client.SendAsync(request);
    }

    public static Guid IdOf(this JsonElement item) => item.GetProperty("id").GetGuid();

    public static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 13)];
}
