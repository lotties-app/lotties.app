using Lotties.Application.Stores;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Data-plane repositories fail closed without their baby bound (docs/design/47-bring-your-own-database.md section 3.6, task T2):
/// a test that resolves one outside a request binds the babies first, as the request or job it stands in for would.
/// </summary>
internal static class StoreScopes
{
    /// <summary>A DI scope of the host with <paramref name="babyIds"/> entered in its <see cref="IStoreScope"/>.</summary>
    public static async Task<AsyncServiceScope> CreateScopeForAsync(this WebApplicationFactory<Program> factory, params Guid[] babyIds)
    {
        var scope = factory.Services.CreateAsyncScope();
        var stores = scope.ServiceProvider.GetRequiredService<IStoreScope>();
        foreach (var babyId in babyIds)
        {
            await stores.EnterAsync(babyId);
        }

        return scope;
    }
}
