using System.Net;
using System.Text;
using Lotties.Api.Authentication;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Authentication;

public sealed class KeycloakAccountRemoverTests
{
    private const string Authority = "https://auth.example.test/realms/lotties.app";

    private static AuthOptions Configured() => new() { Authority = Authority, AdminClientId = "admin", AdminClientSecret = "secret" };

    private static KeycloakAccountRemover Remover(AuthOptions options, Func<HttpRequestMessage, HttpResponseMessage> respond, List<HttpRequestMessage>? seen = null) =>
        new(new HttpClient(new Stub(respond, seen)), Options.Create(options), NullLogger<KeycloakAccountRemover>.Instance);

    private static HttpResponseMessage Token() =>
        new(HttpStatusCode.OK) { Content = new StringContent("""{"access_token":"tok"}""", Encoding.UTF8, "application/json") };

    [Fact]
    public async Task Remove_NoAdminCredentials_DoesNotCallKeycloak()
    {
        var seen = new List<HttpRequestMessage>();

        var removed = await Remover(new AuthOptions { Authority = Authority }, _ => Token(), seen).RemoveAsync(Authority, "sub-1");

        Assert.False(removed);
        Assert.Empty(seen);
    }

    [Fact]
    public async Task Remove_ForeignIssuer_DoesNotCallKeycloak()
    {
        var seen = new List<HttpRequestMessage>();

        var removed = await Remover(Configured(), _ => Token(), seen).RemoveAsync("https://other.example.test/realms/x", "sub-1");

        Assert.False(removed);
        Assert.Empty(seen);
    }

    [Fact]
    public async Task Remove_Configured_GetsATokenThenDeletesTheUserInTheRealm()
    {
        var seen = new List<(HttpMethod Method, string Url, string? Auth)>();
        var remover = Remover(Configured(), request =>
        {
            seen.Add((request.Method, request.RequestUri!.AbsoluteUri, request.Headers.Authorization?.Parameter));
            return request.Method == HttpMethod.Post ? Token() : new HttpResponseMessage(HttpStatusCode.NoContent);
        });

        var removed = await remover.RemoveAsync(Authority + "/", "sub 1");

        Assert.True(removed);
        Assert.Equal(
            [
                (HttpMethod.Post, $"{Authority}/protocol/openid-connect/token", (string?)null),
                (HttpMethod.Delete, "https://auth.example.test/admin/realms/lotties.app/users/sub%201", "tok"),
            ],
            seen);
    }

    [Fact]
    public async Task Remove_KeycloakFails_ReturnsFalseWithoutThrowing()
    {
        var removed = await Remover(Configured(), request => request.Method == HttpMethod.Post ? Token() : new HttpResponseMessage(HttpStatusCode.Forbidden)).RemoveAsync(Authority, "sub-1");

        Assert.False(removed);
    }

    [Fact]
    public async Task Remove_UserAlreadyGone_CountsAsRemoved()
    {
        var removed = await Remover(Configured(), request => request.Method == HttpMethod.Post ? Token() : new HttpResponseMessage(HttpStatusCode.NotFound)).RemoveAsync(Authority, "sub-1");

        Assert.True(removed);
    }

    private sealed class Stub(Func<HttpRequestMessage, HttpResponseMessage> respond, List<HttpRequestMessage>? seen) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            seen?.Add(request);
            return Task.FromResult(respond(request));
        }
    }
}
