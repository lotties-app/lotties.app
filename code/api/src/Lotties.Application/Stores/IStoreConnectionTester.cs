using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// The owner's "Test connection" (docs/design/47-bring-your-own-database.md section 3.4, task T6): opens the saved descriptor,
/// connects through the egress guard, audits the app role and checks the schema, without migrating or writing anything. Bounded
/// work (one resolve per endpoint, one connection per role, a fixed list of queries). Never throws for what the store answered: the
/// outcome is a coarse code.
/// </summary>
public interface IStoreConnectionTester
{
    Task<StoreCheckResult> TestAsync(DataStore store, CancellationToken cancellationToken = default);

    /// <summary>
    /// Which store the database behind <paramref name="candidate"/>'s descriptor says it belongs to, on both endpoints (the same pinned,
    /// guarded connections as the test). Reads only: no table, schema, lock or row is created or written there. Unlike
    /// <see cref="TestAsync"/> a failure to connect throws: <see cref="StoreEndpointRejectedException"/> for a refused host, port or
    /// CA, else the <see cref="StoreFailureException"/> of its class (task T8), with nothing of the database's own text.
    /// </summary>
    Task<StoreDatabaseIdentity> ReadIdentityAsync(DataStore candidate, CancellationToken cancellationToken = default);
}

/// <summary>
/// The outcome of a connection test: <see cref="Code"/> is <see cref="OkCode"/>, an egress guard code (<c>endpoint_*</c>: the typed
/// host, port or CA is refused) or the wire code of a store failure class (task T8, <see cref="StoreFailureCodes"/>, with
/// <see cref="Failure"/> set); <see cref="Findings"/> are the role audit's machine codes. Nothing in it comes from the database's own
/// text or names an address.
/// </summary>
public sealed record StoreCheckResult(string Code, IReadOnlyList<StoreRoleFinding> Findings, StoreFailureClass? Failure = null)
{
    public const string OkCode = "ok";

    public static StoreCheckResult Ok { get; } = new(OkCode, []);

    public bool IsOk => Code == OkCode;

    /// <summary>A failure of class <paramref name="failure"/>.</summary>
    public static StoreCheckResult Of(StoreFailureClass failure, IReadOnlyList<StoreRoleFinding>? findings = null) =>
        new(StoreFailureCodes.Of(failure), findings ?? [], failure);

    /// <summary>An egress guard refusal (<c>endpoint_*</c>): the typed details are not allowed.</summary>
    public static StoreCheckResult Rejected(StoreEndpointFailure failure) => new(StoreEndpointRejectedException.CodeOf(failure), []);

    /// <summary>
    /// Whether a test that ended in <paramref name="failure"/> says "try again later" rather than "fix your setup": the store is down,
    /// paused, slow, busy or being migrated. Those answer 503 with <c>Retry-After</c> like any store failure (task T8); the rest
    /// (refused credentials, TLS, a too powerful role, a foreign or newer schema, a full database, a failed migration) are answers
    /// about the setup the owner asked to check, so they come back as a 200 with their code (docs/design/47 section 3.4).
    /// </summary>
    public static bool IsTransient(StoreFailureClass failure) =>
        failure is StoreFailureClass.Unavailable
            or StoreFailureClass.Timeout
            or StoreFailureClass.PausedOrUnreachable
            or StoreFailureClass.RateLimited
            or StoreFailureClass.Migrating;
}
