using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

/// <summary>
/// The failure taxonomy of external stores (docs/design/47-bring-your-own-database.md section 5, task T8): the SQLSTATE table, the
/// wire codes, which classes open the circuit breaker, and the exception of each class.
/// </summary>
public sealed class StoreFailureTests
{
    [Theory]
    [InlineData("28P01", StoreFailureClass.CredentialsRejected)]
    [InlineData("28000", StoreFailureClass.CredentialsRejected)]
    [InlineData("42501", StoreFailureClass.CredentialsRejected)]
    [InlineData("53300", StoreFailureClass.RateLimited)]
    [InlineData("53100", StoreFailureClass.QuotaFull)]
    [InlineData("25006", StoreFailureClass.QuotaFull)]
    [InlineData("57014", StoreFailureClass.Timeout)]
    [InlineData("25P03", StoreFailureClass.Timeout)]
    [InlineData("55P03", StoreFailureClass.Timeout)]
    [InlineData("42P01", StoreFailureClass.SchemaConflict)]
    [InlineData("42703", StoreFailureClass.SchemaConflict)]
    [InlineData("3F000", StoreFailureClass.SchemaConflict)]
    [InlineData("3D000", StoreFailureClass.Unavailable)]
    [InlineData("57P01", StoreFailureClass.Unavailable)]
    [InlineData("57P02", StoreFailureClass.Unavailable)]
    [InlineData("57P03", StoreFailureClass.Unavailable)]
    [InlineData("08006", StoreFailureClass.Unavailable)]
    [InlineData("08001", StoreFailureClass.Unavailable)]
    [InlineData("53200", StoreFailureClass.Unavailable)]
    [InlineData("58030", StoreFailureClass.Unavailable)]
    [InlineData("XX000", StoreFailureClass.Unavailable)]
    public void SqlStates_StoreFailureCodes_HaveTheirClass(string sqlState, StoreFailureClass expected)
    {
        Assert.Equal(expected, StoreSqlStates.Classify(sqlState));
    }

    [Theory]
    [InlineData("23505")]
    [InlineData("23503")]
    [InlineData("22P02")]
    [InlineData("40001")]
    [InlineData("42601")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("X")]
    public void SqlStates_ErrorsThatAreNotStoreFailures_HaveNoClass(string? sqlState)
    {
        Assert.Null(StoreSqlStates.Classify(sqlState));
    }

    [Fact]
    public void Codes_AreStoreCodesAndDistinct()
    {
        var codes = Enum.GetValues<StoreFailureClass>().Select(StoreFailureCodes.Of).ToArray();

        Assert.All(codes, code => Assert.StartsWith("store_", code, StringComparison.Ordinal));
        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains("store_paused_or_unreachable", codes);
        Assert.Contains("store_quota_full", codes);
        Assert.Contains("store_rate_limited", codes);
    }

    [Fact]
    public void CountsAsConnectionFailure_OnlyClassesThatSayTheStoreCannotBeReached()
    {
        var counted = Enum.GetValues<StoreFailureClass>().Where(StoreFailureCodes.CountsAsConnectionFailure).ToArray();

        Assert.Equal(
            [StoreFailureClass.Unavailable, StoreFailureClass.Timeout, StoreFailureClass.CredentialsRejected, StoreFailureClass.PausedOrUnreachable, StoreFailureClass.RateLimited, StoreFailureClass.TlsFailed],
            counted);
    }

    [Fact]
    public void Of_EveryClass_IsANewExceptionWithThatClassCodeAndRetryAfter()
    {
        foreach (var failure in Enum.GetValues<StoreFailureClass>())
        {
            var first = StoreFailureException.Of(failure, TimeSpan.FromSeconds(7));
            var second = StoreFailureException.Of(failure);

            Assert.Equal((failure, StoreFailureCodes.Of(failure), TimeSpan.FromSeconds(7)), (first.Failure, first.Code, first.RetryAfter));
            Assert.Null(second.RetryAfter);
            Assert.NotSame(first, second);
            Assert.Null(first.InnerException);
        }
    }

    [Fact]
    public void ExistingStoreExceptions_AreStoreFailuresWithTheirCodes()
    {
        Assert.Equal("store_unavailable", new StoreUnavailableException().Code);
        Assert.Equal(StoreFailureClass.Migrating, new StoreMigratingException().Failure);
        Assert.Equal(StoreFailureClass.SchemaAhead, new StoreSchemaAheadException().Failure);
        Assert.Equal(StoreFailureClass.SchemaConflict, new StoreSchemaConflictException().Failure);
        Assert.Equal(StoreFailureClass.MigrationFailed, new StoreMigrationFailedException().Failure);
        Assert.Equal("store_role_too_powerful", new StoreRoleTooPowerfulException([]).Code);
    }

    [Fact]
    public void FindIn_StoreFailureWrappedTwice_IsFound()
    {
        var failure = new StoreTimeoutException();

        Assert.Same(failure, StoreFailureException.FindIn(new InvalidOperationException("save failed", new AggregateException(failure))));
        Assert.Same(failure, StoreFailureException.FindIn(failure));
        Assert.Null(StoreFailureException.FindIn(new InvalidOperationException("other", new TimeoutException())));
        Assert.Null(StoreFailureException.FindIn(null));
    }
}
