using Npgsql;

namespace Lotties.Infrastructure.Persistence.Errors;

/// <summary>PostgreSQL: SQLSTATE <c>23505</c> (<c>unique_violation</c>), raised for primary keys and unique indexes.</summary>
internal sealed class NpgsqlUniqueViolationDetector : IUniqueViolationDetector
{
    public bool IsUniqueViolation(Exception providerException) =>
        providerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}
