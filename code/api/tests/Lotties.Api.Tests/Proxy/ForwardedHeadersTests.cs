using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Proxy;
using Lotties.Api.Tests.Support;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Proxy;

/// <summary>
/// The API behind a reverse proxy (Traefik in the cluster, nginx in compose): the client address and scheme come
/// from <c>X-Forwarded-*</c> only when the connection is from a trusted network.
/// </summary>
public sealed class ForwardedHeadersTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string TrustedProxy = "10.42.0.7";
    private const string UntrustedPeer = "203.0.113.50";
    private const string Client = "198.51.100.23";

    [Fact]
    public async Task FromTrustedProxy_ClientAddressAndScheme_ComeFromTheHeaders()
    {
        var context = await ForwardAsync(factory, TrustedProxy, forwardedFor: Client, forwardedProto: "https");

        Assert.Equal((IPAddress.Parse(Client), "https"), (context.Connection.RemoteIpAddress, context.Request.Scheme));
    }

    [Fact]
    public async Task FromTrustedProxy_ChainSentByTheClient_OnlyTheLastEntryIsUsed()
    {
        var context = await ForwardAsync(factory, TrustedProxy, forwardedFor: $"192.0.2.1, {Client}");

        Assert.Equal(IPAddress.Parse(Client), context.Connection.RemoteIpAddress);
    }

    [Fact]
    public async Task FromTrustedProxyAsIPv4MappedAddress_ClientAddressComesFromTheHeader()
    {
        var context = await ForwardAsync(factory, $"::ffff:{TrustedProxy}", forwardedFor: Client);

        Assert.Equal(IPAddress.Parse(Client), context.Connection.RemoteIpAddress);
    }

    [Fact]
    public async Task FromUntrustedPeer_HeadersAreIgnored()
    {
        var context = await ForwardAsync(factory, UntrustedPeer, forwardedFor: Client, forwardedProto: "https");

        Assert.Equal((IPAddress.Parse(UntrustedPeer), "http"), (context.Connection.RemoteIpAddress, context.Request.Scheme));
    }

    [Fact]
    public async Task ConfiguredNetworks_ReplaceThePrivateRanges()
    {
        using var configured = factory.WithWebHostBuilder(builder => builder.UseSetting("ForwardedHeaders:TrustedNetworks", "10.42.0.0/16"));

        var fromPodNetwork = await ForwardAsync(configured, TrustedProxy, forwardedFor: Client);
        var fromLan = await ForwardAsync(configured, "192.168.1.10", forwardedFor: Client);

        Assert.Equal(
            (IPAddress.Parse(Client), IPAddress.Parse("192.168.1.10")),
            (fromPodNetwork.Connection.RemoteIpAddress, fromLan.Connection.RemoteIpAddress));
    }

    [Fact]
    public void Start_TrustedNetworkNotCidr_Fails()
    {
        using var configured = factory.WithWebHostBuilder(builder => builder.UseSetting("ForwardedHeaders:TrustedNetworks", "10.0.0.0/8,proxy.local"));

        var exception = Assert.Throws<OptionsValidationException>(() => configured.CreateClient());

        Assert.Contains(ForwardedHeadersSettingsValidator.InvalidNetworkMessagePrefix + "proxy.local", exception.Failures);
    }

    [Fact]
    public async Task RateLimitPerAddress_BehindTrustedProxy_CountsEachClientSeparately()
    {
        using var host = WithRemoteAddressAndOneActionPerMinute();
        var client = host.CreateClient();

        var first = await PostActionAsync(client, TrustedProxy, "198.51.100.1");
        var second = await PostActionAsync(client, TrustedProxy, "198.51.100.2");

        Assert.Equal((HttpStatusCode.Conflict, HttpStatusCode.Conflict), (first.StatusCode, second.StatusCode));
    }

    [Fact]
    public async Task RateLimitPerAddress_FromUntrustedPeer_ForgedClientAddressesShareOneWindow()
    {
        using var host = WithRemoteAddressAndOneActionPerMinute();
        var client = host.CreateClient();

        var first = await PostActionAsync(client, UntrustedPeer, "198.51.100.1");
        var second = await PostActionAsync(client, UntrustedPeer, "198.51.100.2");

        Assert.Equal(HttpStatusCode.Conflict, first.StatusCode);
        await second.AssertProblemAsync(HttpStatusCode.TooManyRequests, "rate_limited");
    }

    private static async Task<HttpContext> ForwardAsync(
        WebApplicationFactory<Program> host, string peer, string forwardedFor, string? forwardedProto = null)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        context.Request.Scheme = "http";
        context.Request.Headers["X-Forwarded-For"] = forwardedFor;
        if (forwardedProto is not null)
        {
            context.Request.Headers["X-Forwarded-Proto"] = forwardedProto;
        }

        var options = host.Services.GetRequiredService<IOptions<ForwardedHeadersOptions>>();
        var middleware = new ForwardedHeadersMiddleware(_ => Task.CompletedTask, NullLoggerFactory.Instance, options);
        await middleware.Invoke(context);
        return context;
    }

    private WebApplicationFactory<Program> WithRemoteAddressAndOneActionPerMinute() =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("RequestLimits:PushActionPermitsPerMinute", "1");
            builder.ConfigureTestServices(services => services.AddSingleton<IStartupFilter, RemoteAddressStartupFilter>());
        });

    private static Task<HttpResponseMessage> PostActionAsync(HttpClient client, string peer, string forwardedFor)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/push/deliveries/{Guid.NewGuid()}/actions")
        {
            Content = JsonContent.Create(new { action = "snooze", token = "x" }),
        };
        request.Headers.Add(RemoteAddressStartupFilter.Header, peer);
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        return client.SendAsync(request);
    }
}
