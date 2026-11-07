namespace Lotties.Domain.Stores;

/// <summary>
/// Where the migrator role (<c>lotties_migrator</c>) connects: its own host and port, because some providers' poolers
/// cannot run migrations and the migrator must use the direct endpoint while the app role may use the pooler
/// (docs/design/47a-byo-database-spikes.md, consequence 1). It uses the database of <see cref="StoreDescriptor.App"/>.
/// <see cref="ToString"/> is redacted.
/// </summary>
public sealed record StoreMigratorEndpoint
{
    private StoreMigratorEndpoint(string host, int port, string username, StoreSecret password)
    {
        Host = host;
        Port = port;
        Username = username;
        Password = password;
    }

    public string Host { get; }

    public int Port { get; }

    public string Username { get; }

    public StoreSecret Password { get; }

    /// <summary>Validates the shape of every field; throws <see cref="Exceptions.DomainValidationException"/> naming the field (never the value).</summary>
    public static StoreMigratorEndpoint Create(string? host, int port, string? username, string? password) =>
        new(
            StoreFieldText.Token(host, "migrator.host", StoreEndpoint.MaxHostLength),
            StoreFieldText.Port(port, "migrator.port"),
            StoreFieldText.Token(username, "migrator.username", StoreEndpoint.MaxUsernameLength),
            StoreSecret.Create(password, "migrator.password", StoreEndpoint.MaxPasswordLength));

    public override string ToString() => $"{nameof(StoreMigratorEndpoint)} {{ {StoreSecret.Redacted} }}";
}
