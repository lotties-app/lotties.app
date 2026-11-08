using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// A family's database as the API sees it from the outside: a TLS front door on loopback, in process, in front of the container's
/// plain Postgres port. It answers the client's <c>SSLRequest</c> with <c>S</c>, completes TLS with a certificate for
/// <see cref="HostName"/> issued by a test CA of its own (<see cref="CaPem"/>, what a user pastes for a private CA), then relays the
/// decrypted Postgres protocol to the container byte for byte. So the production pinned, name-verified TLS connection
/// (<c>PinnedStoreDataSourceFactory</c>) runs unchanged against a real Postgres whose container has no TLS of its own.
/// <see cref="Stop"/> closes the port and every relayed connection, as a stopped database host would.
/// </summary>
public sealed class TlsPostgresProxy : IAsyncDisposable
{
    /// <summary>The name the certificate is issued for (what the user types as the host; the test's resolver maps it to loopback).</summary>
    public const string HostName = "db.example.com";

    private const int SslRequestCode = 80877103;

    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly X509Certificate2 _certificate;
    private readonly string _upstreamHost;
    private readonly int _upstreamPort;
    private readonly CancellationTokenSource _stop = new();
    private readonly ConcurrentDictionary<TcpClient, byte> _open = new();
    private readonly Task _loop;
    private int _accepted;

    public TlsPostgresProxy(string upstreamHost, int upstreamPort)
    {
        _upstreamHost = upstreamHost;
        _upstreamPort = upstreamPort;
        using var ca = CreateCa();
        CaPem = ca.ExportCertificatePem();
        _certificate = CreateServer(ca);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;

        // Off the caller's SynchronizationContext (see FakePostgresTlsServer in Lotties.Infrastructure.Tests): xUnit's test threads can
        // be busy long enough for the client to run into its connect timeout before the proxy accepts.
        _loop = Task.Run(AcceptLoopAsync);
    }

    /// <summary>The loopback port of the front door (a store's "public" port in the tests).</summary>
    public int Port { get; }

    /// <summary>The PEM of the CA that issued the front door's certificate.</summary>
    public string CaPem { get; }

    /// <summary>Connections the front door accepted.</summary>
    public int Accepted => Volatile.Read(ref _accepted);

    /// <summary>Closes the port and every relayed connection; nothing answers on the port afterwards (connections are refused).</summary>
    public void Stop()
    {
        _stop.Cancel();
        _listener.Stop();
        foreach (var client in _open.Keys)
        {
            client.Dispose();
        }
    }

    public async ValueTask DisposeAsync()
    {
        Stop();
        await _loop.ContinueWith(_ => { }, TaskScheduler.Default);
        _certificate.Dispose();
        _stop.Dispose();
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            var client = await _listener.AcceptTcpClientAsync(_stop.Token);
            Interlocked.Increment(ref _accepted);
            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        _open[client] = 0;
        using var upstream = new TcpClient();
        try
        {
            await RelayAsync(client, upstream);
        }
        catch (Exception exception) when (exception is IOException or SocketException or ObjectDisposedException or OperationCanceledException or System.Security.Authentication.AuthenticationException)
        {
        }
        finally
        {
            _open.TryRemove(client, out _);
            client.Dispose();
        }
    }

    private async Task RelayAsync(TcpClient client, TcpClient upstream)
    {
        var network = client.GetStream();
        var request = new byte[8];
        await network.ReadExactlyAsync(request, _stop.Token);
        if (BinaryPrimitives.ReadInt32BigEndian(request.AsSpan(4)) != SslRequestCode)
        {
            return;
        }

        await network.WriteAsync("S"u8.ToArray(), _stop.Token);
        await using var tls = new SslStream(network, leaveInnerStreamOpen: false);
        await tls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions { ServerCertificate = _certificate }, _stop.Token);
        await upstream.ConnectAsync(_upstreamHost, _upstreamPort, _stop.Token);
        _open[upstream] = 0;
        try
        {
            var plain = upstream.GetStream();
            await Task.WhenAny(tls.CopyToAsync(plain, _stop.Token), plain.CopyToAsync(tls, _stop.Token));
        }
        finally
        {
            _open.TryRemove(upstream, out _);
        }
    }

    private static X509Certificate2 CreateCa()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=Lotties test store CA", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
        var now = DateTimeOffset.UtcNow;
        return request.CreateSelfSigned(now.AddDays(-1), now.AddDays(30));
    }

    private static X509Certificate2 CreateServer(X509Certificate2 issuer)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={HostName}", key, HashAlgorithmName.SHA256);
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName(HostName);
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid("1.3.6.1.5.5.7.3.1")], false));
        request.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(issuer, true, false));
        var now = DateTimeOffset.UtcNow;
        using var signed = request.Create(issuer, now.AddHours(-1), now.AddDays(7), RandomNumberGenerator.GetBytes(16));
        using var withKey = signed.CopyWithPrivateKey(key);
        return X509CertificateLoader.LoadPkcs12(withKey.Export(X509ContentType.Pfx), null);
    }
}
