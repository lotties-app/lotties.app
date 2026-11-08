using Lotties.Api.Errors;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The one HTTP mapping of store failures (docs/design/47-bring-your-own-database.md section 5, task T8): every <c>store_*</c> class is a
/// retriable 503 and carries a whole-second <c>Retry-After</c>, the server's own wait when it knows one.
/// </summary>
public sealed class StoreFailureResponsesTests
{
    [Fact]
    public void Status_EveryStoreFailureType_Is503()
    {
        var types = typeof(StoreFailureException).Assembly.GetTypes()
            .Where(type => type.IsSubclassOf(typeof(StoreFailureException)) && !type.IsAbstract)
            .ToArray();

        Assert.Equal(Enum.GetValues<StoreFailureClass>().Length, types.Length);
        Assert.All(Enum.GetValues<StoreFailureClass>(), failure => Assert.Equal(503, DomainExceptionStatusCodes.For(StoreFailureException.Of(failure))));
    }

    [Fact]
    public void Status_ProgrammingErrorsOfTheScope_Stay500()
    {
        Assert.Equal(500, DomainExceptionStatusCodes.For(new StoreScopeMissingException(null)));
        Assert.Equal(500, DomainExceptionStatusCodes.For(new StoreScopeAmbiguousException()));
    }

    [Theory]
    [InlineData(StoreFailureClass.Timeout, 5)]
    [InlineData(StoreFailureClass.RateLimited, 5)]
    [InlineData(StoreFailureClass.Migrating, 5)]
    [InlineData(StoreFailureClass.Moving, 15)]
    [InlineData(StoreFailureClass.Unavailable, 30)]
    [InlineData(StoreFailureClass.PausedOrUnreachable, 30)]
    [InlineData(StoreFailureClass.CredentialsRejected, 30)]
    [InlineData(StoreFailureClass.QuotaFull, 30)]
    public void RetryAfter_WithoutAKnownWait_IsTheClassDefault(StoreFailureClass failure, int seconds)
    {
        Assert.Equal(seconds, StoreFailureResponses.RetryAfterSeconds(StoreFailureException.Of(failure)));
    }

    [Theory]
    [InlineData(12_300, 13)]
    [InlineData(1, 1)]
    [InlineData(0, 1)]
    public void RetryAfter_KnownWait_IsRoundedUpToWholeSecondsAndAtLeastOne(int milliseconds, int seconds)
    {
        var failure = StoreFailureException.Of(StoreFailureClass.Unavailable, TimeSpan.FromMilliseconds(milliseconds));

        Assert.Equal(seconds, StoreFailureResponses.RetryAfterSeconds(failure));
    }
}
