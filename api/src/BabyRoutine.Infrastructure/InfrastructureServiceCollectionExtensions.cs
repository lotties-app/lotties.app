using BabyRoutine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    /// <summary>Registers <paramref name="databaseOptions"/> and a scoped <see cref="BabyRoutineDbContext"/>.</summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, DatabaseOptions databaseOptions)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(databaseOptions);
        services.AddSingleton(databaseOptions);
        services.AddDbContext<BabyRoutineDbContext>(options => options.UseBabyRoutineDatabase(databaseOptions.ToConnectionString()));
        return services;
    }
}
