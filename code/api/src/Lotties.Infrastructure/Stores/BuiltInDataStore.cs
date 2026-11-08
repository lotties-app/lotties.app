using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The Lotties database as a data store (scoped): its data context is the scope's <see cref="LottiesDataDbContext"/>, registered
/// with <c>AddDbContext</c> on the control context's connection (task T1), so a hosted baby's queries and transactions are the
/// ones they were before the stores existed.
/// </summary>
internal sealed class BuiltInDataStore(IServiceProvider scopeServices) : IDataStore
{
    public DataStoreKey Key => DataStoreKey.BuiltIn;

    public LottiesDataDbContext CreateContext() => scopeServices.GetRequiredService<LottiesDataDbContext>();
}
