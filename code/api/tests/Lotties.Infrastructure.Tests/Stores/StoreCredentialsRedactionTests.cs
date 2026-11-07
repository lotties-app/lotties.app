using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Logging;
using static Lotties.Infrastructure.Tests.Stores.StoreTestKit;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>Credentials never reach a log line, a log value or an exception (docs/design/47-bring-your-own-database.md section 3.3).</summary>
public sealed class StoreCredentialsRedactionTests
{
    private static readonly (string Id, string Key) K1 = ("k1", Key(0x00));
    private static readonly (string Id, string Key) K2 = ("k2", Key(0x80));

    [Fact]
    public void EveryPath_LogsAndExceptions_NeverCarryACredential()
    {
        var logger = new CapturingLogger<StoreCredentials>();
        var credentials = Credentials(Wrapper("k1", K1), logger);
        var rotating = Credentials(Wrapper("k2", K1, K2), logger);
        var otherStore = new StoreSealContext(Guid.NewGuid(), Context.OwnerId);
        var forged = StoreCredentialsTests.SealRaw(Wrapper("k1", K1), System.Text.Encoding.UTF8.GetBytes($"{{\"v\":1,\"providerLabel\":\"{AppPassword}\",\"app\":{{\"host\":\"{AppHost};x\"}}}}"));

        var sealedDescriptor = credentials.Seal(Descriptor(), Context);
        var opened = credentials.Open(sealedDescriptor, Context);
        var rewrapped = rotating.Rewrap(sealedDescriptor, Context);
        var failures = new[]
        {
            Record.Exception(() => credentials.Open(sealedDescriptor, otherStore)),
            Record.Exception(() => credentials.Open(rewrapped, Context)),
            Record.Exception(() => rotating.Rewrap(sealedDescriptor, otherStore)),
            Record.Exception(() => credentials.Open(forged, Context)),
            Record.Exception(() => credentials.Open(SealedDescriptor.FromBytes([1, 2, 3]), Context)),
        };

        Assert.All(failures, failure => Assert.IsType<StoreCredentialsUnreadableException>(failure));
        Assert.All(failures, failure => Assert.Null(failure!.InnerException));
        Assert.Equal(Descriptor(), opened);
        Assert.Contains(logger.Entries, entry => entry.Level == LogLevel.Warning);
        var printed = string.Join(
            "\n",
            logger.Entries.SelectMany(entry => entry.Values.Append(entry.Message).Append(entry.Exception?.ToString() ?? string.Empty))
                .Concat(failures.Select(failure => failure!.ToString()))
                .Append(opened.ToString())
                .Append(sealedDescriptor.ToString())
                .Append(SealedDescriptorEnvelope.Parse(sealedDescriptor.AsSpan()).ToString()));
        Assert.All(Secrets, secret => Assert.DoesNotContain(secret, printed));
    }

    [Fact]
    public void LoggedValues_AreTheStoreIdKeyIdAndFailureClassOnly()
    {
        var logger = new CapturingLogger<StoreCredentials>();
        var credentials = Credentials(Wrapper("k1", K1), logger);
        var sealedDescriptor = credentials.Seal(Descriptor(), Context);

        Assert.Throws<StoreCredentialsUnreadableException>(() => credentials.Open(sealedDescriptor, new StoreSealContext(Context.StoreId, Guid.NewGuid())));

        var names = logger.Entries.SelectMany(entry => entry.Values).Select(value => value.Split('=')[0]).ToHashSet(StringComparer.Ordinal);
        Assert.True(names.SetEquals(["{OriginalFormat}", "Failure", "KeyId", "StoreId"]), string.Join(",", names));
    }
}
