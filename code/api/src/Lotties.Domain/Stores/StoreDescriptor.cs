namespace Lotties.Domain.Stores;

/// <summary>
/// How Lotties reaches a family's own Postgres (docs/design/47-bring-your-own-database.md D4 and section 3.3): a provider
/// label, the app endpoint, the migrator endpoint and the TLS policy, all as typed fields from which the API builds the
/// connection string (never a free connection string). At rest it only exists sealed (<see cref="SealedDescriptor"/>).
/// Immutable; every part validates its own shape on creation. <see cref="ToString"/> never prints a field: hosts, user
/// names, databases and passwords must not reach a log or an exception message.
/// </summary>
public sealed record StoreDescriptor
{
    public const int MaxProviderLabelLength = 64;

    private StoreDescriptor(string providerLabel, StoreEndpoint app, StoreMigratorEndpoint migrator, StoreTlsPolicy tls)
    {
        ProviderLabel = providerLabel;
        App = app;
        Migrator = migrator;
        Tls = tls;
    }

    /// <summary>The provider the user picked or typed (for example a hosting company's name); display only.</summary>
    public string ProviderLabel { get; }

    public StoreEndpoint App { get; }

    public StoreMigratorEndpoint Migrator { get; }

    public StoreTlsPolicy Tls { get; }

    /// <summary>Validates the provider label and assembles the parts (each already validated by its own <c>Create</c>).</summary>
    public static StoreDescriptor Create(string? providerLabel, StoreEndpoint app, StoreMigratorEndpoint migrator, StoreTlsPolicy tls)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(migrator);
        ArgumentNullException.ThrowIfNull(tls);
        return new StoreDescriptor(StoreFieldText.Label(providerLabel, "providerLabel", MaxProviderLabelLength), app, migrator, tls);
    }

    public override string ToString() => $"{nameof(StoreDescriptor)} {{ {StoreSecret.Redacted} }}";
}
