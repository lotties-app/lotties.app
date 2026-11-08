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
}

/// <summary>
/// The outcome of a connection test: <see cref="Code"/> is <see cref="OkCode"/> or the code of what failed (the egress guard's
/// <c>endpoint_*</c> codes, or <c>store_unavailable</c>, <c>store_timeout</c>, <c>store_credentials_rejected</c>, <c>store_role_too_powerful</c>,
/// <c>store_schema_conflict</c>, <c>store_schema_ahead</c>); <see cref="Findings"/> are the role audit's machine codes. Nothing in it
/// comes from the database's own text or names an address.
/// </summary>
public sealed record StoreCheckResult(string Code, IReadOnlyList<StoreRoleFinding> Findings)
{
    public const string OkCode = "ok";

    /// <summary>The database refused the user name or password (the code of task T8's <c>StoreFailureClass.CredentialsRejected</c>).</summary>
    public const string AuthFailedCode = "store_credentials_rejected";

    /// <summary>The test did not finish within its budget (the code of task T8's <c>StoreFailureClass.Timeout</c>).</summary>
    public const string TimeoutCode = "store_timeout";

    public static StoreCheckResult Ok { get; } = new(OkCode, []);

    public bool IsOk => Code == OkCode;

    public static StoreCheckResult Failed(string code) => new(code, []);
}
