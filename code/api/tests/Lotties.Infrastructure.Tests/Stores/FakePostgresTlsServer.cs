using System.Buffers.Binary;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// A minimal Postgres front door on loopback, in process: answers the SSLRequest with <c>S</c>, completes TLS with the given
/// certificate, reads the startup message and answers "password authentication failed" (SQLSTATE 28P01). A client that sees
/// 28P01 got through TLS; a client whose certificate check refuses the server never gets there.
/// </summary>
internal sealed class FakePostgresTlsServer : IAsyncDisposable
{
    private const int SslRequestCode = 80877103;

    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly X509Certificate2 _certificate;
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _loop;

    public FakePostgresTlsServer(X509Certificate2 certificate)
    {
        _certificate = certificate;
        _listener.Start();
        _loop = AcceptLoopAsync();
    }

    public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

    /// <summary>The SNI names the server saw, one per completed handshake.</summary>
    public List<string> ServerNames { get; } = [];

    /// <summary>Startup messages received after TLS (the client trusted the server).</summary>
    public int StartupMessages { get; private set; }

    public async ValueTask DisposeAsync()
    {
        await _stop.CancelAsync();
        _listener.Stop();
        await _loop.ContinueWith(_ => { }, TaskScheduler.Default);
        _stop.Dispose();
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            var client = await _listener.AcceptTcpClientAsync(_stop.Token);
            _ = ServeAsync(client);
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                await ServeTlsAsync(client.GetStream());
            }
            catch (Exception exception) when (exception is IOException or SocketException or ObjectDisposedException or OperationCanceledException or System.Security.Authentication.AuthenticationException)
            {
            }
        }
    }

    private async Task ServeTlsAsync(NetworkStream network)
    {
        var request = new byte[8];
        await network.ReadExactlyAsync(request, _stop.Token);
        if (BinaryPrimitives.ReadInt32BigEndian(request.AsSpan(4)) != SslRequestCode)
        {
            return;
        }

        await network.WriteAsync("S"u8.ToArray(), _stop.Token);
        await using var tls = new SslStream(network);
        await tls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions { ServerCertificate = _certificate }, _stop.Token);
        ServerNames.Add(tls.TargetHostName);
        await ReadStartupAsync(tls);
        StartupMessages++;
        await tls.WriteAsync(AuthenticationFailed(), _stop.Token);
        await tls.FlushAsync(_stop.Token);
    }

    private async Task ReadStartupAsync(SslStream tls)
    {
        var length = new byte[4];
        await tls.ReadExactlyAsync(length, _stop.Token);
        var body = new byte[BinaryPrimitives.ReadInt32BigEndian(length) - 4];
        await tls.ReadExactlyAsync(body, _stop.Token);
    }

    private static byte[] AuthenticationFailed()
    {
        var fields = Encoding.ASCII.GetBytes("SFATAL\0VFATAL\0C28P01\0Mpassword authentication failed\0\0");
        var message = new byte[1 + 4 + fields.Length];
        message[0] = (byte)'E';
        BinaryPrimitives.WriteInt32BigEndian(message.AsSpan(1), 4 + fields.Length);
        fields.CopyTo(message, 5);
        return message;
    }
}
