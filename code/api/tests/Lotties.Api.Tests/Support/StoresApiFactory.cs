using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Consents;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// The API with bring-your-own-database on (<c>Stores:Enabled</c>, a random test key-encryption key) and a fixed pool of allowlisted
/// account subjects (<see cref="TakeAllowedSubject"/>), so the data-store routes (task T6) answer. Nothing reaches the network: the
/// egress guard's DNS resolver is <see cref="FakeStoreHostResolver"/> (public names resolve to a public address, names under
/// <see cref="FakeStoreHostResolver.PrivateSuffix"/> to a private one) and the connection test is <see cref="FakeStoreConnectionTester"/>.
/// Every log line (with its exception) is kept in <see cref="Logs"/>. The endpoint role matrix runs on this host too.
/// </summary>
public class StoresApiFactory : ApiFactory
{
    public const int AllowedSubjects = 40;

    private const string TestKeyId = "t6-test";

    private readonly string[] _allowed = Enumerable.Range(0, AllowedSubjects).Select(index => $"byo|allowed-{index}-{Guid.NewGuid():N}").ToArray();
    private int _nextAllowed = -1;

    public FakeStoreConnectionTester Tester { get; } = new();

    public RecordingStoreHealth Health { get; } = new();

    internal CapturingLogs Logs { get; } = new();

    /// <summary>A subject on <c>Stores:Allowlist</c> that no other test of this host used.</summary>
    public string TakeAllowedSubject() => _allowed[Interlocked.Increment(ref _nextAllowed)];

    /// <summary>Seeds a baby whose Owner signs in as <paramref name="ownerSubject"/> (plus members), like <c>SeedBabyAsync</c>.</summary>
    internal async Task<SeededBaby> SeedBabyOwnedByAsync(string ownerSubject, params BabyRole[] memberRoles)
    {
        var owner = User.Create(User.UnknownIssuer, ownerSubject, "Owner", TestUsers.Now);
        var members = memberRoles.Select(role => (Role: role, User: User.Create(User.UnknownIssuer, TestUsers.NewSubject(), role.ToString(), TestUsers.Now))).ToArray();
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), owner.Id, TestUsers.Now);
        Array.ForEach(members, member => baby.AddMember(member.User.Id, member.Role, TestUsers.Now));
        await SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Users.AddRange(members.Select(member => member.User));
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        return new SeededBaby(baby.Id, ownerSubject, members.ToDictionary(member => member.Role, member => member.User.Subject));
    }

    /// <summary>Gives the optional <c>byo_database</c> consent to the account signed in as <paramref name="subject"/>.</summary>
    public Task GrantByoConsentAsync(string subject) =>
        SeedAsync(async context =>
        {
            var user = context.Users.Single(candidate => candidate.Subject == subject);
            context.UserConsents.Add(UserConsent.Grant(user.Id, ConsentKind.ByoDatabase, ConsentVersions.Current.Version, capacity: null, "en", TestUsers.Now));
            await Task.CompletedTask;
        });

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Stores:Enabled", "true");
        builder.UseSetting("Stores:CurrentKeyId", TestKeyId);
        builder.UseSetting($"Stores:KeyEncryptionKeys:{TestKeyId}", Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        for (var index = 0; index < _allowed.Length; index++)
        {
            builder.UseSetting($"Stores:Allowlist:{index}", _allowed[index]);
        }

        builder.ConfigureTestServices(services =>
        {
            services.Replace(ServiceDescriptor.Singleton<IHostResolver, FakeStoreHostResolver>());
            services.Replace(ServiceDescriptor.Singleton<IStoreConnectionTester>(Tester));
            services.Replace(ServiceDescriptor.Singleton<IStoreHealth>(Health));
            services.AddSingleton<ILoggerProvider>(Logs);
        });
    }
}

/// <summary>DNS without the network: <see cref="PrivateSuffix"/> names resolve to a private address, every other name to a public one.</summary>
public sealed class FakeStoreHostResolver : IHostResolver
{
    public const string PrivateSuffix = ".lab-internal-db.com";

    public static readonly IPAddress PublicAddress = IPAddress.Parse("8.8.4.4");

    public Task<IReadOnlyList<IPAddress>> ResolveAsync(string hostName, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<IPAddress>>(hostName.EndsWith(PrivateSuffix, StringComparison.Ordinal) ? [IPAddress.Parse("10.1.2.3")] : [PublicAddress]);
}

/// <summary>A connection test that answers <see cref="Result"/> without connecting, counting its calls.</summary>
public sealed class FakeStoreConnectionTester : IStoreConnectionTester
{
    private int _calls;

    public StoreCheckResult Result { get; set; } = StoreCheckResult.Ok;

    public int Calls => _calls;

    public Task<StoreCheckResult> TestAsync(DataStore store, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _calls);
        return Task.FromResult(Result);
    }
}

/// <summary>Records which stores were forgotten (<see cref="IStoreHealth.Forget"/>).</summary>
public sealed class RecordingStoreHealth : IStoreHealth
{
    private readonly ConcurrentQueue<Guid> _forgotten = new();

    public IReadOnlyList<Guid> Forgotten => _forgotten.ToArray();

    public void Forget(Guid storeId) => _forgotten.Enqueue(storeId);
}

/// <summary>Every log line of the host: category, formatted message and the exception's full text.</summary>
internal sealed class CapturingLogs : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _lines = new();

    public IReadOnlyList<string> Lines => _lines.ToArray();

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _lines);

    public void Dispose()
    {
    }

    private sealed class Logger(string category, ConcurrentQueue<string> lines) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            lines.Enqueue($"{category}: {formatter(state, exception)} {exception}");
    }
}
