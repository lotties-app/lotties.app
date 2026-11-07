using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>Synthetic keys, descriptors and a capturing logger for the store credential tests.</summary>
internal static class StoreTestKit
{
    public const string AppHost = "db.example.test";
    public const string AppDatabase = "familydb";
    public const string AppUser = "lotties_app";
    public const string AppPassword = "app-secret-1";
    public const string MigratorHost = "direct.example.test";
    public const string MigratorUser = "lotties_migrator";
    public const string MigratorPassword = "mig-secret-2";

    public static readonly StoreSealContext Context = new(Guid.Parse("11111111-2222-3333-4444-555555555555"), Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));

    public static IReadOnlyList<string> Secrets { get; } = [AppHost, AppDatabase, AppUser, AppPassword, MigratorHost, MigratorUser, MigratorPassword];

    public static byte[] Sequence(byte start, int length) => Enumerable.Range(start, length).Select(value => (byte)value).ToArray();

    public static string Key(byte start) => Convert.ToBase64String(Sequence(start, StoreCredentialsOptions.KeySizeBytes));

    public static string RandomKey() => Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(StoreCredentialsOptions.KeySizeBytes));

    public static StoreCredentialsOptions Options(string currentKeyId, params (string Id, string Key)[] keys) => new()
    {
        Enabled = true,
        CurrentKeyId = currentKeyId,
        KeyEncryptionKeys = keys.ToDictionary(key => key.Id, key => key.Key, StringComparer.Ordinal),
    };

    public static ConfiguredKeyWrapper Wrapper(string currentKeyId, params (string Id, string Key)[] keys) =>
        new(Microsoft.Extensions.Options.Options.Create(Options(currentKeyId, keys)));

    public static StoreCredentials Credentials(IKeyWrapper wrapper, CapturingLogger<StoreCredentials>? logger = null) =>
        new(wrapper, logger ?? new CapturingLogger<StoreCredentials>());

    public static StoreDescriptor Descriptor(string? caPem = null) => StoreDescriptor.Create(
        "Example",
        StoreEndpoint.Create(AppHost, 5432, AppDatabase, AppUser, AppPassword),
        StoreMigratorEndpoint.Create(MigratorHost, 5432, MigratorUser, MigratorPassword),
        StoreTlsPolicy.Create(StoreSslMode.VerifyFull, caPem));

    /// <summary>A random source that hands out the given chunks in order (known-answer tests).</summary>
    public static RandomFill Scripted(params byte[][] chunks)
    {
        var queue = new Queue<byte[]>(chunks);
        return buffer =>
        {
            var next = queue.Dequeue();
            Assert.Equal(buffer.Length, next.Length);
            next.CopyTo(buffer);
        };
    }
}

internal sealed record CapturedLog(LogLevel Level, string Message, IReadOnlyList<string> Values, Exception? Exception);

internal sealed class CapturingLogger<T> : ILogger<T>
{
    private readonly List<CapturedLog> _entries = [];

    public IReadOnlyList<CapturedLog> Entries => _entries;

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        var values = state is IEnumerable<KeyValuePair<string, object?>> pairs
            ? pairs.Select(pair => $"{pair.Key}={pair.Value}").ToArray()
            : [];
        _entries.Add(new CapturedLog(logLevel, formatter(state, exception), values, exception));
    }
}
