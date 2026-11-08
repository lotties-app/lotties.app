using System.Data.Common;
using System.Security.Cryptography;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// Which sealed descriptor a pool was built from: a SHA-256 of the sealed bytes (ciphertext, never the plaintext). Every seal draws a
/// fresh data key and nonce, so saving new credentials (or re-wrapping under a new key) always gives another version.
/// </summary>
internal readonly record struct DescriptorVersion
{
    private DescriptorVersion(string value) => Value = value;

    public string Value { get; }

    public static DescriptorVersion Of(byte[] sealedDescriptor)
    {
        ArgumentNullException.ThrowIfNull(sealedDescriptor);
        return new DescriptorVersion(Convert.ToHexString(SHA256.HashData(sealedDescriptor)));
    }

    public override string ToString() => Value;
}

/// <summary>
/// One store's pooled data source on its app role, with the store's failure interceptor, the contexts made on it that are not disposed
/// yet (<see cref="Leases"/>) and when it was last used and retired. Thread safe; the retirement is set under
/// <see cref="ExternalDataStores"/>'s lock.
/// </summary>
internal sealed class ExternalStorePool(Guid storeId, DescriptorVersion version, NpgsqlDataSource dataSource, StoreFailureInterceptor failures, TimeProvider time)
{
    private long _lastUsed = time.GetTimestamp();
    private long? _retiredAt;
    private int _leases;
    private int _closed;

    public Guid StoreId => storeId;

    public DescriptorVersion Version => version;

    public NpgsqlDataSource DataSource => dataSource;

    public StoreFailureInterceptor Failures => failures;

    /// <summary>Contexts made on this pool and not disposed yet.</summary>
    public int Leases => Volatile.Read(ref _leases);

    /// <summary>The timestamp (<see cref="TimeProvider.GetTimestamp"/>) of the last use.</summary>
    public long LastUsed => Volatile.Read(ref _lastUsed);

    public bool IsRetired => _retiredAt is not null;

    /// <summary>Whether the data source was disposed.</summary>
    public bool IsClosed => Volatile.Read(ref _closed) == 1;

    /// <summary>A store handle for one request; it creates the request's contexts on this pool.</summary>
    public ExternalDataStore Use()
    {
        Touch();
        return new ExternalDataStore(this);
    }

    /// <summary>Counts a context made on the pool until <see cref="ExternalStorePoolLease"/> sees its connection disposed.</summary>
    public ExternalStorePoolLease Lease()
    {
        Interlocked.Increment(ref _leases);
        Touch();
        return new ExternalStorePoolLease(this);
    }

    public bool IsIdle(TimeSpan idleFor) => Leases == 0 && time.GetElapsedTime(LastUsed) >= idleFor;

    public void Retire() => _retiredAt ??= time.GetTimestamp();

    /// <summary>A retired pool can go once no context uses it and the grace passed, or anyway after <paramref name="limit"/>.</summary>
    public bool CanBeDisposed(TimeSpan grace, TimeSpan limit)
    {
        if (_retiredAt is not { } retiredAt)
        {
            return false;
        }

        var retiredFor = time.GetElapsedTime(retiredAt);
        return retiredFor >= limit || (Leases == 0 && retiredFor >= grace);
    }

    /// <summary>Disposes the data source (once), which closes every physical connection it still holds.</summary>
    public void Close()
    {
        if (Interlocked.Exchange(ref _closed, 1) == 0)
        {
            dataSource.Dispose();
        }
    }

    internal void Release()
    {
        Interlocked.Decrement(ref _leases);
        Touch();
    }

    private void Touch() => Volatile.Write(ref _lastUsed, time.GetTimestamp());
}

/// <summary>
/// The external store handed to one <see cref="StoreScope"/>: each <see cref="CreateContext"/> is a new, unpooled data context on a
/// connection of the store's pool, in the external store's shape, carrying the store's failure interceptor (task T8) and a lease that
/// keeps the pool from being disposed while the context lives. The context owns its connection: disposing it (the scope does) returns
/// the physical connection to the pool and ends the lease.
/// </summary>
internal sealed class ExternalDataStore(ExternalStorePool pool) : IDataStore
{
    public DataStoreKey Key { get; } = DataStoreKey.External(pool.StoreId);

    public LottiesDataDbContext CreateContext()
    {
        var lease = pool.Lease();
        try
        {
            return Context(pool.DataSource.CreateConnection(), lease);
        }
        catch
        {
            lease.Release();
            throw;
        }
    }

    /// <summary>
    /// The context, with its relational connection created at once: EF disposes an owned connection (and so ends the lease) only when the
    /// context created its connection service, which a context disposed before its first query would not have.
    /// </summary>
    private LottiesDataDbContext Context(DbConnection connection, ExternalStorePoolLease lease)
    {
        var options = new DbContextOptionsBuilder<LottiesDataDbContext>(ExternalStoreSchema.Options(connection, contextOwnsConnection: true))
            .AddInterceptors(pool.Failures, lease)
            .Options;
        var context = new LottiesDataDbContext(options);
        _ = context.Database.GetDbConnection();
        return context;
    }
}

/// <summary>Ends a context's lease on its pool when EF disposes the context's connection (once).</summary>
internal sealed class ExternalStorePoolLease(ExternalStorePool pool) : DbConnectionInterceptor
{
    private int _released;

    public override void ConnectionDisposed(DbConnection connection, ConnectionEndEventData eventData) => Release();

    public override Task ConnectionDisposedAsync(DbConnection connection, ConnectionEndEventData eventData)
    {
        Release();
        return Task.CompletedTask;
    }

    public void Release()
    {
        if (Interlocked.Exchange(ref _released, 1) == 0)
        {
            pool.Release();
        }
    }
}
