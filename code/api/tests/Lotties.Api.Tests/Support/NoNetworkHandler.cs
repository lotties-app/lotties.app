namespace Lotties.Api.Tests.Support;

/// <summary>
/// The primary handler of the address lookup HTTP client in every test host: a request that reaches it is a test that
/// forgot to fake the upstream, so it fails loudly instead of calling BrasilAPI, ViaCEP or OpenStreetMap.
/// </summary>
internal sealed class NoNetworkHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        throw new InvalidOperationException($"Tests must not reach the network ({request.RequestUri?.Host}); fake the address upstream.");
}
