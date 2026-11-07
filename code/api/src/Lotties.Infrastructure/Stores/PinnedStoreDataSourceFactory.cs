using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Npgsql;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// Builds the Npgsql data source of a user's store from a <see cref="PinnedEndpoint"/>, with the recipe of
/// docs/design/47a-byo-database-spikes.md (b): <c>Host</c> is the pinned address (Npgsql never resolves a name, so DNS cannot
/// redirect a new physical connection), <c>SslMode=Require</c> (Npgsql refuses <c>VerifyFull</c> with a custom callback) and
/// our own validation in <c>UseSslClientAuthenticationOptionsCallback</c>: <c>TargetHost</c> (and SNI) is the typed name,
/// and the certificate is accepted only with no policy error at all, i.e. a chain to the system trust store (or only to the
/// user's CA when given) and a name that matches. Every other option is fixed by us; none comes from the user.
/// </summary>
public sealed class PinnedStoreDataSourceFactory
{
    /// <summary>The <c>Application Name</c> every store connection reports.</summary>
    public const string ApplicationName = "lotties";

    /// <summary>Connect timeout, in seconds.</summary>
    public const int ConnectTimeoutSeconds = 5;

    /// <summary>Command timeout, in seconds.</summary>
    public const int CommandTimeoutSeconds = 15;

    /// <summary>Most physical connections per store.</summary>
    public const int MaxPoolSize = 5;

    /// <summary>
    /// The data source of one store. <paramref name="customRoots"/> (from <see cref="StoreTrustAnchors.FromPem"/>) replaces
    /// the system trust store when the provider uses a private CA; null uses the system trust store.
    /// </summary>
    public NpgsqlDataSource Create(PinnedEndpoint endpoint, StoreConnectionFields fields, X509Certificate2Collection? customRoots = null) =>
        Create(endpoint, fields, customRoots, AcceptOnlyValidCertificate);

    /// <summary>
    /// Opens a connection of <paramref name="dataSource"/>; a failed TLS handshake or a refused certificate becomes
    /// <see cref="StoreEndpointRejectedException"/> (<c>endpoint_tls_failed</c>) without the Npgsql exception (its text can
    /// carry the address and user), other failures are left to the caller.
    /// </summary>
    public static async Task<NpgsqlConnection> OpenAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dataSource);
        try
        {
            return await dataSource.OpenConnectionAsync(cancellationToken);
        }
        catch (Exception exception) when (IsTlsFailure(exception))
        {
            throw new StoreEndpointRejectedException(StoreEndpointFailure.TlsFailed);
        }
    }

    /// <summary>The certificate rule: present, and no chain or name error of any kind.</summary>
    internal static bool AcceptOnlyValidCertificate(object sender, X509Certificate? certificate, X509Chain? chain, SslPolicyErrors errors) =>
        certificate is not null && errors == SslPolicyErrors.None;

    /// <summary>Test seam: the same data source with another certificate callback (to prove the tests catch a callback that accepts everything).</summary>
    internal static NpgsqlDataSource Create(
        PinnedEndpoint endpoint,
        StoreConnectionFields fields,
        X509Certificate2Collection? customRoots,
        RemoteCertificateValidationCallback validation)
    {
        var builder = new NpgsqlDataSourceBuilder(ConnectionString(endpoint, fields));
        builder.UseSslClientAuthenticationOptionsCallback(options => ConfigureTls(options, endpoint.HostName, customRoots, validation));
        return builder.Build();
    }

    /// <summary>The connection string: pinned address, fixed options, the user's three fields as values only.</summary>
    internal static string ConnectionString(PinnedEndpoint endpoint, StoreConnectionFields fields)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(fields);
        return new NpgsqlConnectionStringBuilder
        {
            Host = endpoint.Address.ToString(),
            Port = endpoint.Port,
            Database = fields.Database,
            Username = fields.Username,
            Password = fields.Password,
            SslMode = SslMode.Require,
            GssEncryptionMode = GssEncryptionMode.Disable,
            Timeout = ConnectTimeoutSeconds,
            CommandTimeout = CommandTimeoutSeconds,
            Pooling = true,
            MinPoolSize = 0,
            MaxPoolSize = MaxPoolSize,
            ApplicationName = ApplicationName,
            IncludeErrorDetail = false,
            LogParameters = false,
            Enlist = false,
            Multiplexing = false,
        }.ConnectionString;
    }

    private static void ConfigureTls(
        SslClientAuthenticationOptions options,
        StoreHostName hostName,
        X509Certificate2Collection? customRoots,
        RemoteCertificateValidationCallback validation)
    {
        options.TargetHost = hostName.Value;
        options.RemoteCertificateValidationCallback = validation;
        options.CertificateChainPolicy = ChainPolicy(customRoots);
        options.ClientCertificates = [];
        options.LocalCertificateSelectionCallback = null;
        options.EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13;
    }

    /// <summary>
    /// The chain policy of one handshake: the system trust store, or only the user's CA; never a certificate download (no
    /// AIA or root fetch: the server must send its intermediates, and the API opens no extra connection to a URL the
    /// certificate names).
    /// </summary>
    private static X509ChainPolicy ChainPolicy(X509Certificate2Collection? customRoots)
    {
        var policy = new X509ChainPolicy
        {
            TrustMode = customRoots is null ? X509ChainTrustMode.System : X509ChainTrustMode.CustomRootTrust,
            RevocationMode = X509RevocationMode.NoCheck,
            DisableCertificateDownloads = true,
        };
        policy.CustomTrustStore.AddRange(customRoots ?? []);
        return policy;
    }

    private static bool IsTlsFailure(Exception exception) =>
        exception is AuthenticationException || (exception.InnerException is { } inner && IsTlsFailure(inner));
}
