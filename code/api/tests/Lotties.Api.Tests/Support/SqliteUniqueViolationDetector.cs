using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.Data.Sqlite;

namespace Lotties.Api.Tests.Support;

/// <summary>Test-only: SQLite unique and primary-key constraint failures, so the test database races like PostgreSQL.</summary>
internal sealed class SqliteUniqueViolationDetector : IUniqueViolationDetector
{
    private const int ConstraintError = 19;
    private const int PrimaryKeyViolation = 1555;
    private const int UniqueViolation = 2067;

    public bool IsUniqueViolation(Exception providerException) =>
        providerException is SqliteException { SqliteErrorCode: ConstraintError, SqliteExtendedErrorCode: PrimaryKeyViolation or UniqueViolation };
}
