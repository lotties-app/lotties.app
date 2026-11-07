namespace Lotties.Domain.Stores;

/// <summary>
/// Where the app role (<c>lotties_app</c>) of a family's own Postgres is reached: host, port, database, user name and
/// password, typed in separate fields (docs/design/47-bring-your-own-database.md D4). Shape only: whether the host is
/// public and the port allowed is the egress guard's job. <see cref="ToString"/> is redacted.
/// </summary>
public sealed record StoreEndpoint
{
    /// <summary>A DNS name is at most 253 characters.</summary>
    public const int MaxHostLength = 253;

    /// <summary>Postgres identifiers are at most 63 bytes.</summary>
    public const int MaxDatabaseLength = 63;

    /// <summary>Room for a 63-character role plus a pooler suffix such as Supabase's <c>role.&lt;project-ref&gt;</c>.</summary>
    public const int MaxUsernameLength = 128;

    public const int MaxPasswordLength = 256;

    private StoreEndpoint(string host, int port, string database, string username, StoreSecret password)
    {
        Host = host;
        Port = port;
        Database = database;
        Username = username;
        Password = password;
    }

    public string Host { get; }

    public int Port { get; }

    public string Database { get; }

    public string Username { get; }

    public StoreSecret Password { get; }

    /// <summary>Validates the shape of every field; throws <see cref="Exceptions.DomainValidationException"/> naming the field (never the value).</summary>
    public static StoreEndpoint Create(string? host, int port, string? database, string? username, string? password) =>
        new(
            StoreFieldText.Token(host, "app.host", MaxHostLength),
            StoreFieldText.Port(port, "app.port"),
            StoreFieldText.Token(database, "app.database", MaxDatabaseLength),
            StoreFieldText.Token(username, "app.username", MaxUsernameLength),
            StoreSecret.Create(password, "app.password", MaxPasswordLength));

    public override string ToString() => $"{nameof(StoreEndpoint)} {{ {StoreSecret.Redacted} }}";
}
