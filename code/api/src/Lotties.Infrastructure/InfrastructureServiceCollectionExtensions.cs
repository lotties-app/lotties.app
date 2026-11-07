using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Errors;
using Lotties.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    /// <summary>
    /// Registers <paramref name="databaseOptions"/>, the scoped <see cref="LottiesDbContext"/> (control plane) and
    /// <see cref="LottiesDataDbContext"/> (data plane, opened on the control context's connection: every baby's data is in the
    /// built-in database), the PostgreSQL <see cref="IUniqueViolationDetector"/> (another provider, e.g. a test database, adds
    /// its own) and the repositories.
    /// </summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, DatabaseOptions databaseOptions)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(databaseOptions);
        services.AddSingleton(databaseOptions);
        services.AddDbContext<LottiesDbContext>(options => options.UseLottiesDatabase(databaseOptions.ToConnectionString()));
        services.AddDbContext<LottiesDataDbContext>((provider, options) => options.UseLottiesDatabase(SharedConnection(provider)));
        services.AddScoped<BuiltInUnitOfWork>();
        services.AddSingleton<IUniqueViolationDetector, NpgsqlUniqueViolationDetector>();
        services.AddSingleton<UniqueViolations>();
        services.AddScoped<IUserRepository, EfUserRepository>();
        services.AddScoped<IDemoAccountRepository, EfDemoAccountRepository>();
        services.AddScoped<IAccountDataEraser, EfAccountDataEraser>();
        services.AddScoped<IBabyMembershipRepository, EfBabyMembershipRepository>();
        services.AddScoped<IBabyRepository, EfBabyRepository>();
        services.AddScoped<IInviteRepository, EfInviteRepository>();
        services.AddScoped<IMedicationRepository, EfMedicationRepository>();
        services.AddScoped<IMeasurementRepository, EfMeasurementRepository>();
        services.AddScoped<Lotties.Domain.Catalog.ICatalogRepository, EfCatalogRepository>();
        services.AddScoped<Lotties.Domain.Prescriptions.IPrescriptionRepository, EfPrescriptionRepository>();
        services.AddScoped<Lotties.Domain.Prescriptions.IMedicationDoseHistoryRepository, EfMedicationDoseHistoryRepository>();
        services.AddScoped<Lotties.Domain.Formulas.IFormulaRepository, EfFormulaRepository>();
        services.AddScoped<Lotties.Domain.Appointments.IAppointmentRepository, EfAppointmentRepository>();
        services.AddScoped<Lotties.Domain.CareProviders.ICareProviderRepository, EfCareProviderRepository>();
        services.AddScoped<Lotties.Domain.Vaccinations.IVaccinationRepository, EfVaccinationRepository>();
        services.AddScoped<Lotties.Domain.Professionals.IProfessionalProfileRepository, EfProfessionalProfileRepository>();
        services.AddScoped<Lotties.Domain.Notes.INoteRepository, EfNoteRepository>();
        services.AddScoped<Lotties.Domain.AccessLogs.IAccessLogRepository, EfAccessLogRepository>();
        services.AddScoped<Lotties.Domain.Proposals.IPrescriptionProposalRepository, EfPrescriptionProposalRepository>();
        services.AddScoped<Lotties.Domain.Notes.INoteReadRepository, EfNoteReadRepository>();
        services.AddScoped<IEventRepository, EfEventRepository>();
        services.AddScoped<IEventTypeRepository, EfEventTypeRepository>();
        services.AddScoped<Lotties.Domain.Imports.IImportRepository, EfImportRepository>();
        services.AddScoped<Lotties.Domain.Backups.IBackupSession, EfBackupSession>();
        services.AddScoped<Lotties.Domain.Predictions.IPredictionHistoryRepository, EfPredictionHistoryRepository>();
        services.AddScoped<Lotties.Domain.Clinical.IClinicalEventRepository, EfClinicalEventRepository>();
        services.AddScoped<Lotties.Domain.Assistants.IUserAssistantSettingsRepository, EfUserAssistantSettingsRepository>();
        services.AddScoped<Lotties.Domain.Units.IUserUnitSettingsRepository, EfUserUnitSettingsRepository>();
        services.AddScoped<Lotties.Domain.FeedingPreferences.IUserFeedingSettingsRepository, EfUserFeedingSettingsRepository>();
        services.AddScoped<Lotties.Domain.Rest.IUserRestRepository, EfUserRestRepository>();
        services.AddScoped<Lotties.Domain.Consents.IUserConsentRepository, EfUserConsentRepository>();
        services.AddScoped<Lotties.Domain.Board.IBoardRepository, EfBoardRepository>();
        services.AddScoped<Lotties.Domain.Board.IBoardApiKeyRepository, EfBoardApiKeyRepository>();
        return services;
    }

    /// <summary>
    /// The connection of the scope's <see cref="LottiesDbContext"/>, which owns it; the data context opens and closes it as
    /// needed but never disposes it, and a transaction on it can hold both planes (<see cref="BuiltInUnitOfWork"/>).
    /// </summary>
    public static System.Data.Common.DbConnection SharedConnection(IServiceProvider provider) =>
        provider.GetRequiredService<LottiesDbContext>().Database.GetDbConnection();
}
