using System.Text;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// Body of <c>PUT /babies/{babyId}/data-store</c>: the typed connection details (docs/design/47-bring-your-own-database.md D4),
/// never a connection string. <see cref="ToString"/> prints nothing of it, so a log of the request object cannot leak a field.
/// </summary>
public sealed record SaveDataStoreRequest
{
    public string? ProviderLabel { get; init; }

    public DataStoreAppEndpointRequest? App { get; init; }

    public DataStoreMigratorEndpointRequest? Migrator { get; init; }

    public DataStoreTlsRequest? Tls { get; init; }

    /// <summary>The descriptor of these fields; throws <see cref="DomainValidationException"/> naming the field (never its value).</summary>
    public static explicit operator StoreDescriptor(SaveDataStoreRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var app = request.App ?? throw new DomainValidationException("app", "app is required.");
        var migrator = request.Migrator ?? throw new DomainValidationException("migrator", "migrator is required.");
        return StoreDescriptor.Create(
            request.ProviderLabel,
            StoreEndpoint.Create(app.Host, app.Port ?? 0, app.Database, app.Username, app.Password),
            StoreMigratorEndpoint.Create(migrator.Host, migrator.Port ?? 0, migrator.Username, migrator.Password),
            StoreTlsPolicy.Create(DataStoreTlsRequest.SslModeOf(request.Tls?.SslMode), request.Tls?.CaCertificatePem));
    }

    public override string ToString() => nameof(SaveDataStoreRequest) + " { " + StoreSecret.Redacted + " }";
}

/// <summary>The app role's endpoint (<c>lotties_app</c>, DML only).</summary>
public sealed record DataStoreAppEndpointRequest
{
    public string? Host { get; init; }

    public int? Port { get; init; }

    public string? Database { get; init; }

    public string? Username { get; init; }

    public string? Password { get; init; }

    public override string ToString() => nameof(DataStoreAppEndpointRequest) + " { " + StoreSecret.Redacted + " }";
}

/// <summary>The migrator role's endpoint (<c>lotties_migrator</c>; the direct or session-mode endpoint), on the app endpoint's database.</summary>
public sealed record DataStoreMigratorEndpointRequest
{
    public string? Host { get; init; }

    public int? Port { get; init; }

    public string? Username { get; init; }

    public string? Password { get; init; }

    public override string ToString() => nameof(DataStoreMigratorEndpointRequest) + " { " + StoreSecret.Redacted + " }";
}

/// <summary>The TLS policy: <c>verify_full</c> (the only mode, and the default) and an optional pasted CA in PEM form.</summary>
public sealed record DataStoreTlsRequest
{
    public const string VerifyFull = "verify_full";

    public string? SslMode { get; init; }

    public string? CaCertificatePem { get; init; }

    internal static StoreSslMode SslModeOf(string? sslMode) =>
        sslMode is null || string.Equals(sslMode, VerifyFull, StringComparison.Ordinal)
            ? StoreSslMode.VerifyFull
            : throw new DomainValidationException("tls.sslMode", "tls.sslMode must be verify_full.");

    public override string ToString() => nameof(DataStoreTlsRequest) + " { " + StoreSecret.Redacted + " }";
}

/// <summary>
/// <c>GET /babies/{babyId}/data-store</c>: <see cref="Kind"/> is <c>hosted</c> (the records are in Lotties' database) or
/// <c>own</c> (in the family's database); <see cref="Store"/> is the store being set up or in use, <c>null</c> when there is none;
/// <see cref="Move"/> is the baby's latest move between the two (task T7), <c>null</c> when it never moved.
/// </summary>
public sealed record DataStoreStatusResponse(string Kind, DataStoreStatus? Store, DataStoreMoveStatus? Move = null);

/// <summary>
/// A move of the baby's records (task T7; the answer of <c>POST .../move-in</c> and <c>.../move-out</c>, and <c>move</c> of the status).
/// <see cref="Direction"/> is <c>in</c> (into the family's database) or <c>out</c> (back to Lotties). <see cref="State"/>:
/// <c>copying</c> and <c>verifying</c> (writes for the baby answer <c>503 store_moving</c>), <c>moved</c> (done; the old copy is kept
/// until <see cref="OldCopyKeptUntil"/>, and the opposite move until then is the undo), <c>completed</c> (the old copy was deleted at
/// <see cref="OldCopyDeletedAt"/>, or, when that is null, could not be reached because the database was disconnected) and
/// <c>failed</c> (the records stayed where they were; <see cref="FailureCode"/> says why). <see cref="RecordsCopied"/> and
/// <see cref="RecordsTotal"/> show the progress of a running copy. Never an id, a host or a record.
/// </summary>
public sealed record DataStoreMoveStatus(
    string Direction,
    string State,
    int RecordsCopied,
    int? RecordsTotal,
    DateTimeOffset StartedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? MovedAt,
    DateTimeOffset? OldCopyKeptUntil,
    DateTimeOffset? OldCopyDeletedAt,
    string? FailureCode,
    bool CanUndo);

/// <summary>
/// A store as the owner sees it: state (<c>pending</c>, <c>ready</c>, <c>unreachable</c>, ...), the provider label, whether a
/// descriptor is saved, the data schema version and the last test. Never a host, user, database, password or CA.
/// </summary>
public sealed record DataStoreStatus(
    string State,
    string? ProviderLabel,
    bool HasDescriptor,
    string? SchemaVersion,
    DateTimeOffset? LastCheckedAt,
    string? LastCheckResult,
    DateTimeOffset UpdatedAt);

/// <summary>
/// <c>POST /babies/{babyId}/data-store/test</c>: <see cref="Result"/> is <c>ok</c> or a coarse failure code; <see cref="Findings"/>
/// lists why the app role is too powerful (<c>superuser_like</c>, <c>owns_objects</c>, <c>creates_in_public</c>,
/// <c>creates_in_store_schema</c>).
/// </summary>
public sealed record DataStoreTestResponse(bool Ok, string Result, IReadOnlyList<string> Findings, DateTimeOffset CheckedAt);

/// <summary>Maps stores and test results to their responses, with snake_case wire names for enum values.</summary>
internal static class DataStoreViews
{
    public const string HostedKind = "hosted";
    public const string OwnKind = "own";

    public static DataStoreStatusResponse Status(Guid? pointer, DataStore? store, DataStoreMoveStatus? move = null) =>
        new(pointer is null ? HostedKind : OwnKind, store is null ? null : StatusOf(store), move);

    /// <summary>The move as the owner sees it at <paramref name="now"/>; it can be undone while it is moved and its old copy is kept.</summary>
    public static DataStoreMoveStatus Move(DataStoreMove move, DateTimeOffset now) =>
        new(
            SnakeCase(move.Direction.ToString()),
            SnakeCase(move.State.ToString()),
            move.RecordsCopied,
            move.RecordsTotal,
            move.StartedAt,
            move.UpdatedAt,
            move.MovedAt,
            move.State == DataStoreMoveState.Moved ? move.OldCopyDeleteAfter : null,
            move.OldCopyDeletedAt,
            move.FailureCode,
            move.State == DataStoreMoveState.Moved && move.OldCopyDeleteAfter > now);

    public static DataStoreTestResponse Test(StoreCheckResult result, DateTimeOffset checkedAt) =>
        new(result.IsOk, result.Code, result.Findings.Select(finding => SnakeCase(finding.ToString())).ToArray(), checkedAt);

    /// <summary><c>RoleTooPowerful</c> to <c>role_too_powerful</c>.</summary>
    public static string SnakeCase(string name)
    {
        var text = new StringBuilder(name.Length + 4);
        foreach (var character in name)
        {
            AppendSnake(text, character);
        }

        return text.ToString();
    }

    private static DataStoreStatus StatusOf(DataStore store) =>
        new(SnakeCase(store.State.ToString()), store.ProviderLabel, store.HasDescriptor, store.SchemaVersion, store.LastCheckedAt, store.LastCheckResult, store.UpdatedAt);

    private static void AppendSnake(StringBuilder text, char character)
    {
        if (char.IsUpper(character) && text.Length > 0)
        {
            text.Append('_');
        }

        text.Append(char.ToLowerInvariant(character));
    }
}
