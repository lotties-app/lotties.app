using BabyRoutine.Application.Babies;
using BabyRoutine.Application.Events;
using BabyRoutine.Application.EventTypes;
using BabyRoutine.Application.Measurements;
using BabyRoutine.Application.Medications;
using BabyRoutine.Application.Users;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BabyRoutine.Application;

public static class ApplicationServiceCollectionExtensions
{
    /// <summary>
    /// Registers the application services and <see cref="TimeProvider.System"/>. The host must register
    /// <see cref="ICurrentUser"/> and the Domain repositories.
    /// </summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<IUserProvisioningService, UserProvisioningService>();
        services.AddScoped<IBabyAccessService, BabyAccessService>();
        services.AddScoped<IEventService, EventService>();
        services.AddScoped<IBabyService, BabyService>();
        services.AddScoped<IMemberService, MemberService>();
        services.AddScoped<IInviteService, InviteService>();
        services.AddScoped<IEventTypeService, EventTypeService>();
        services.AddScoped<IMedicationService, MedicationService>();
        services.AddScoped<IMeasurementService, MeasurementService>();
        services.AddScoped<Catalog.ICatalogService, Catalog.CatalogService>();
        services.AddScoped<Prescriptions.IPrescriptionService, Prescriptions.PrescriptionService>();
        services.AddScoped<Prescriptions.IMedicationStatusService, Prescriptions.MedicationStatusService>();
        services.AddScoped<Imports.INapperImportService, Imports.NapperImportService>();
        services.TryAddSingleton(BabyRoutine.Domain.Predictions.PredictionOptions.Default);
        services.AddScoped<Predictions.IPredictionService, Predictions.PredictionService>();
        return services;
    }
}
