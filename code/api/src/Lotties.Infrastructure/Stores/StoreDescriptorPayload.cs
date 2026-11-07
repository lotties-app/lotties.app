using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Domain.Stores;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The plaintext inside a sealed descriptor: UTF-8 JSON with a schema version <c>v</c>. A frozen stored format (pinned by
/// a known-answer test); opening re-validates every field through the Domain factories.
/// </summary>
internal sealed class StoreDescriptorPayload
{
    public const int CurrentVersion = 1;
    public const string VerifyFullMode = "verify-full";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    [JsonPropertyName("v")]
    public int Version { get; set; }

    [JsonPropertyName("providerLabel")]
    public string? ProviderLabel { get; set; }

    [JsonPropertyName("app")]
    public AppPayload? App { get; set; }

    [JsonPropertyName("migrator")]
    public MigratorPayload? Migrator { get; set; }

    [JsonPropertyName("tls")]
    public TlsPayload? Tls { get; set; }

    public static byte[] Serialize(StoreDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        var payload = new StoreDescriptorPayload
        {
            Version = CurrentVersion,
            ProviderLabel = descriptor.ProviderLabel,
            App = AppPayload.From(descriptor.App),
            Migrator = MigratorPayload.From(descriptor.Migrator),
            Tls = TlsPayload.From(descriptor.Tls),
        };
        return JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
    }

    /// <summary>
    /// Reads and validates a payload; throws <see cref="JsonException"/>, <see cref="FormatException"/> or
    /// <see cref="Domain.Exceptions.DomainValidationException"/>, which the caller turns into one opaque failure.
    /// </summary>
    public static StoreDescriptor Deserialize(ReadOnlySpan<byte> json)
    {
        var payload = JsonSerializer.Deserialize<StoreDescriptorPayload>(json, JsonOptions);
        return payload is { Version: CurrentVersion, App: not null, Migrator: not null, Tls: not null }
            ? StoreDescriptor.Create(payload.ProviderLabel, payload.App.ToDomain(), payload.Migrator.ToDomain(), payload.Tls.ToDomain())
            : throw new FormatException("The descriptor payload is incomplete or of another version.");
    }

    internal sealed class AppPayload
    {
        [JsonPropertyName("host")]
        public string? Host { get; set; }

        [JsonPropertyName("port")]
        public int Port { get; set; }

        [JsonPropertyName("database")]
        public string? Database { get; set; }

        [JsonPropertyName("username")]
        public string? Username { get; set; }

        [JsonPropertyName("password")]
        public string? Password { get; set; }

        public static AppPayload From(StoreEndpoint app) => new()
        {
            Host = app.Host,
            Port = app.Port,
            Database = app.Database,
            Username = app.Username,
            Password = app.Password.Reveal(),
        };

        public StoreEndpoint ToDomain() => StoreEndpoint.Create(Host, Port, Database, Username, Password);

        public override string ToString() => nameof(AppPayload);
    }

    internal sealed class MigratorPayload
    {
        [JsonPropertyName("host")]
        public string? Host { get; set; }

        [JsonPropertyName("port")]
        public int Port { get; set; }

        [JsonPropertyName("username")]
        public string? Username { get; set; }

        [JsonPropertyName("password")]
        public string? Password { get; set; }

        public static MigratorPayload From(StoreMigratorEndpoint migrator) => new()
        {
            Host = migrator.Host,
            Port = migrator.Port,
            Username = migrator.Username,
            Password = migrator.Password.Reveal(),
        };

        public StoreMigratorEndpoint ToDomain() => StoreMigratorEndpoint.Create(Host, Port, Username, Password);

        public override string ToString() => nameof(MigratorPayload);
    }

    internal sealed class TlsPayload
    {
        [JsonPropertyName("sslMode")]
        public string? SslMode { get; set; }

        [JsonPropertyName("caCertificatePem")]
        public string? CaCertificatePem { get; set; }

        public static TlsPayload From(StoreTlsPolicy tls) => new()
        {
            SslMode = tls.SslMode switch
            {
                StoreSslMode.VerifyFull => VerifyFullMode,
                _ => throw new ArgumentOutOfRangeException(nameof(tls), "Unsupported SSL mode."),
            },
            CaCertificatePem = tls.CaCertificatePem,
        };

        public StoreTlsPolicy ToDomain() => SslMode switch
        {
            VerifyFullMode => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, CaCertificatePem),
            _ => throw new FormatException("Unsupported SSL mode in the descriptor payload."),
        };

        public override string ToString() => nameof(TlsPayload);
    }

    public override string ToString() => nameof(StoreDescriptorPayload);
}
