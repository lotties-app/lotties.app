using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

public sealed class UniqueViolationsTests
{
    private static readonly UniqueViolations Postgres = new([new NpgsqlUniqueViolationDetector()]);

    [Fact]
    public void IsUniqueViolation_PostgresUniqueViolation_ReturnsTrue()
    {
        Assert.True(Postgres.IsUniqueViolation(Failure(PostgresErrorCodes.UniqueViolation)));
    }

    [Theory]
    [InlineData(PostgresErrorCodes.NumericValueOutOfRange)]
    [InlineData(PostgresErrorCodes.ForeignKeyViolation)]
    [InlineData(PostgresErrorCodes.CharacterNotInRepertoire)]
    [InlineData(PostgresErrorCodes.StringDataRightTruncation)]
    public void IsUniqueViolation_OtherPostgresError_ReturnsFalse(string sqlState)
    {
        Assert.False(Postgres.IsUniqueViolation(Failure(sqlState)));
    }

    [Fact]
    public void IsUniqueViolation_NoProviderException_ReturnsFalse()
    {
        Assert.False(Postgres.IsUniqueViolation(new DbUpdateException("failed")));
    }

    [Fact]
    public void IsUniqueViolation_NoDetectorRecognizesIt_ReturnsFalse()
    {
        Assert.False(new UniqueViolations([]).IsUniqueViolation(Failure(PostgresErrorCodes.UniqueViolation)));
    }

    private static DbUpdateException Failure(string sqlState) =>
        new("failed", new PostgresException("failed", "ERROR", "ERROR", sqlState));
}
