using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.AgeNorms;
using Lotties.Domain.Babies;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>GET /age-norms</c> (docs/design/28-age-norms.md): signed-in only, the shipped file with a strong ETag, a 304 on
/// revalidation and a day of private caching; and the embedded provider, which refuses an invalid file.
/// </summary>
public sealed class AgeNormsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/age-norms";

    [Fact]
    public async Task Get_Anonymous_Returns401()
    {
        var response = await factory.CreateClient().GetAsync(Path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Get_ReturnsTheShippedFileWithAnETagAndA304OnRevalidation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, baby.SubjectOf(BabyRole.Owner));

        var response = await client.GetAsync(Path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var etag = response.Headers.ETag;
        Assert.NotNull(etag);
        Assert.Matches("^\"agenorms-\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{8}\"$", etag!.Tag);
        Assert.Equal((true, TimeSpan.FromDays(1)), (response.Headers.CacheControl?.Private, response.Headers.CacheControl?.MaxAge));
        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("schemaVersion").GetInt32());
        Assert.Contains(body.GetProperty("norms").EnumerateArray(), norm => norm.GetProperty("id").GetString() == "feed_volume_ml_per_feed.formula.30-61");

        var revalidation = new HttpRequestMessage(HttpMethod.Get, Path);
        revalidation.Headers.IfNoneMatch.Add(etag);
        var notModified = await client.SendAsync(revalidation);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
        Assert.Empty(await notModified.Content.ReadAsByteArrayAsync());

        var stale = new HttpRequestMessage(HttpMethod.Get, Path);
        stale.Headers.IfNoneMatch.Add(new EntityTagHeaderValue("\"agenorms-2020-01-01-00000000\""));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(stale)).StatusCode);
    }

    [Fact]
    public void Provider_ShippedFile_IsValidAndTaggedByItsContent()
    {
        var provider = new EmbeddedAgeNormsProvider();

        Assert.Equal(91, provider.Norms.Norms.Count);
        Assert.StartsWith($"\"agenorms-{provider.Norms.GeneratedAt:yyyy-MM-dd}-", provider.ETag, StringComparison.Ordinal);
        Assert.Equal(provider.ETag, new EmbeddedAgeNormsProvider(provider.Json.ToArray()).ETag);
    }

    [Fact]
    public void Provider_InvalidFile_ThrowsListingTheBrokenRules()
    {
        var shipped = Encoding.UTF8.GetString(new EmbeddedAgeNormsProvider().Json.Span);
        var broken = Encoding.UTF8.GetBytes(shipped.Replace("\"schemaVersion\": 1", "\"schemaVersion\": 2", StringComparison.Ordinal));

        var error = Assert.Throws<InvalidOperationException>(() => new EmbeddedAgeNormsProvider(broken));

        Assert.Contains("schemaVersion must be 1", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Provider_MalformedFile_ThrowsAFormatException()
    {
        Assert.Throws<FormatException>(() => new EmbeddedAgeNormsProvider(Encoding.UTF8.GetBytes("{\"schemaVersion\": 1}")));
    }
}
