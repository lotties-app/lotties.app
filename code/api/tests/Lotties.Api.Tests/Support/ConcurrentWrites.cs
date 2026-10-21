using Lotties.Domain.Babies;
using Lotties.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Emulates a request that writes the same rows between another request's read and its save, which is how
/// optimistic-concurrency conflicts happen on PostgreSQL. SQLite has no <c>xmin</c>, so the competing write bumps the
/// emulated row version itself (see <see cref="SqliteModelCustomizer"/>).
/// </summary>
internal static class ConcurrentWrites
{
    /// <summary>Name of the shadow row-version property (Infrastructure <c>RowVersions.PropertyName</c>).</summary>
    public const string RowVersionProperty = "Version";

    /// <summary>
    /// A client of a host whose <see cref="IBabyRepository.SaveChangesAsync"/> first runs <paramref name="competingWrite"/>
    /// (once, in its own scope) and then saves: the request loses a race against that write.
    /// </summary>
    public static HttpClient CreateClientLosingRaceTo(this ApiFactory factory, string subject, Func<LottiesDbContext, Task> competingWrite)
    {
        var race = new OneShotWrite(factory, competingWrite);
        var host = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => DecorateBabyRepository(services, race)));
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }

    /// <summary>Changes the row version of <paramref name="entity"/>'s row, as any committed write does on PostgreSQL.</summary>
    public static void BumpRowVersion(this LottiesDbContext context, object entity)
    {
        var version = context.Entry(entity).Property(RowVersionProperty);
        version.CurrentValue = (uint)version.CurrentValue! + 1;
    }

    private static void DecorateBabyRepository(IServiceCollection services, OneShotWrite race)
    {
        var original = services.Last(descriptor => descriptor.ServiceType == typeof(IBabyRepository));
        services.Remove(original);
        services.AddScoped<IBabyRepository>(provider =>
            new RacingBabyRepository((IBabyRepository)ActivatorUtilities.CreateInstance(provider, original.ImplementationType!), race));
    }

    private sealed class OneShotWrite(ApiFactory factory, Func<LottiesDbContext, Task> write)
    {
        private int _done;

        public async Task RunOnceAsync()
        {
            if (Interlocked.Exchange(ref _done, 1) == 1)
            {
                return;
            }

            await using var scope = factory.Services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
            await write(context);
            await context.SaveChangesAsync();
        }
    }

    private sealed class RacingBabyRepository(IBabyRepository inner, OneShotWrite race) : IBabyRepository
    {
        public Task<IReadOnlyList<Baby>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default) => inner.ListForUserAsync(userId, cancellationToken);

        public Task<Baby?> FindAsync(Guid babyId, CancellationToken cancellationToken = default) => inner.FindAsync(babyId, cancellationToken);

        public Task AddAsync(Baby baby, CancellationToken cancellationToken = default) => inner.AddAsync(baby, cancellationToken);

        public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            await race.RunOnceAsync();
            await inner.SaveChangesAsync(cancellationToken);
        }
    }
}

internal static class LottiesDbContextQueries
{
    public static Task<Invite> InviteAsync(this LottiesDbContext context, Guid inviteId) =>
        context.Invites.SingleAsync(invite => invite.Id == inviteId);

    public static Task<Baby> BabyAsync(this LottiesDbContext context, Guid babyId) =>
        context.Babies.Include(baby => baby.Members).SingleAsync(baby => baby.Id == babyId);
}
