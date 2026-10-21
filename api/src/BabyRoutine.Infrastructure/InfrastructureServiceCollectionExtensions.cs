using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Medications;
using BabyRoutine.Domain.Users;
using BabyRoutine.Infrastructure.Persistence;
using BabyRoutine.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    /// <summary>Registers <paramref name="databaseOptions"/>, a scoped <see cref="BabyRoutineDbContext"/> and the repositories.</summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, DatabaseOptions databaseOptions)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(databaseOptions);
        services.AddSingleton(databaseOptions);
        services.AddDbContext<BabyRoutineDbContext>(options => options.UseBabyRoutineDatabase(databaseOptions.ToConnectionString()));
        services.AddScoped<IUserRepository, EfUserRepository>();
        services.AddScoped<IBabyMembershipRepository, EfBabyMembershipRepository>();
        services.AddScoped<IBabyRepository, EfBabyRepository>();
        services.AddScoped<IInviteRepository, EfInviteRepository>();
        services.AddScoped<IMedicationRepository, EfMedicationRepository>();
        services.AddScoped<IEventRepository, EfEventRepository>();
        services.AddScoped<IEventTypeRepository, EfEventTypeRepository>();
        services.AddScoped<BabyRoutine.Domain.Predictions.IPredictionHistoryRepository, EfPredictionHistoryRepository>();
        return services;
    }
}
