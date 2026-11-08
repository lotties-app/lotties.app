using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Infrastructure.Stores;

public static class StoreManagementFallbacks
{
    /// <summary>
    /// Completes the service graph of the data-store routes (task T6) while <c>Stores:Enabled</c> is off: whatever
    /// <c>AddStoreCredentials</c> and <c>AddStoreMigrator</c> did not register (they register nothing with the flag off) gets an
    /// implementation that refuses with <c>store_unavailable</c>. The routes answer 404 before any of them is reached; this only keeps
    /// the container valid. Call after those two.
    /// </summary>
    public static IServiceCollection AddStoreManagementFallbacks(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton<IStoreCredentials, UnavailableStoreCredentials>();
        services.TryAddSingleton<IStoreDescriptorGuard, UnavailableStoreDescriptorGuard>();
        services.TryAddSingleton<IStoreConnectionTester, UnavailableStoreConnectionTester>();
        return services;
    }

    private sealed class UnavailableStoreCredentials : IStoreCredentials
    {
        public SealedDescriptor Seal(StoreDescriptor descriptor, StoreSealContext context) => throw new StoreUnavailableException();

        public StoreDescriptor Open(SealedDescriptor sealedDescriptor, StoreSealContext context) => throw new StoreUnavailableException();

        public SealedDescriptor Rewrap(SealedDescriptor sealedDescriptor, StoreSealContext context) => throw new StoreUnavailableException();

        public bool IsWrappedWithCurrentKey(SealedDescriptor sealedDescriptor) => false;
    }

    private sealed class UnavailableStoreDescriptorGuard : IStoreDescriptorGuard
    {
        public Task CheckAsync(StoreDescriptor descriptor, CancellationToken cancellationToken = default) =>
            Task.FromException(new StoreUnavailableException());
    }

    private sealed class UnavailableStoreConnectionTester : IStoreConnectionTester
    {
        public Task<StoreCheckResult> TestAsync(DataStore store, CancellationToken cancellationToken = default) =>
            Task.FromException<StoreCheckResult>(new StoreUnavailableException());
    }
}
