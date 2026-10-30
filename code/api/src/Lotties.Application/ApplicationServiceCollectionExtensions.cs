using Lotties.Application.Babies;
using Lotties.Application.Events;
using Lotties.Application.EventTypes;
using Lotties.Application.Measurements;
using Lotties.Application.Medications;
using Lotties.Application.Users;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Application;

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
        services.AddScoped<IAccountDeletionService, AccountDeletionService>();
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
        services.AddScoped<Formulas.IFormulaService, Formulas.FormulaService>();
        services.AddScoped<Appointments.IAppointmentService, Appointments.AppointmentService>();
        services.AddScoped<CareProviders.ICareProviderService, CareProviders.CareProviderService>();
        services.AddScoped<AddressLookup.IAddressLookupService, AddressLookup.AddressLookupService>();
        services.AddScoped<Vaccinations.IVaccinationService, Vaccinations.VaccinationService>();
        services.TryAddSingleton<Vaccinations.IVaccineScheduleProvider, Vaccinations.EmbeddedVaccineScheduleProvider>();
        services.TryAddSingleton<AgeNorms.IAgeNormsProvider, AgeNorms.EmbeddedAgeNormsProvider>();
        services.AddScoped<Professionals.IPersonDirectory, Professionals.PersonDirectory>();
        services.AddScoped<Professionals.IProfessionalProfileService, Professionals.ProfessionalProfileService>();
        services.AddScoped<Notes.INoteService, Notes.NoteService>();
        services.AddScoped<Proposals.IPrescriptionProposalService, Proposals.PrescriptionProposalService>();
        services.AddScoped<AccessLogs.IAccessLogService, AccessLogs.AccessLogService>();
        services.AddScoped<Prescriptions.IMedicationStatusService, Prescriptions.MedicationStatusService>();
        services.AddScoped<Imports.INapperImportService, Imports.NapperImportService>();
        services.AddScoped<Backups.IBackupExportService, Backups.BackupExportService>();
        services.AddScoped<Backups.BackupApplier>();
        services.AddScoped<Backups.IBackupImportService, Backups.BackupImportService>();
        services.TryAddSingleton(Lotties.Domain.Predictions.PredictionOptions.Default);
        services.AddScoped<Predictions.IPredictionService, Predictions.PredictionService>();
        services.AddScoped<Clinical.DailyObservationReader>();
        services.AddScoped<Clinical.VaccineOverviewReader>();
        services.AddScoped<Clinical.IClinicalSummaryService, Clinical.ClinicalSummaryService>();
        services.AddScoped<Clinical.ITimelineService, Clinical.TimelineService>();
        services.AddScoped<Clinical.IDoctorPatientsService, Clinical.DoctorPatientsService>();
        services.AddScoped<Assistants.AssistantSubjects>();
        services.AddScoped<Assistants.AssistantForecasts>();
        services.AddScoped<Assistants.AssistantCryReasons>();
        services.AddScoped<Assistants.IAssistantService, Assistants.AssistantService>();
        services.AddScoped<Assistants.IAssistantSettingsService, Assistants.AssistantSettingsService>();
        services.AddScoped<Units.IUnitSettingsService, Units.UnitSettingsService>();
        services.AddScoped<Rest.IRestSettingsService, Rest.RestSettingsService>();
        services.AddScoped<Consents.IConsentService, Consents.ConsentService>();
        services.AddScoped<Units.IUnitPreferences, Units.UnitPreferences>();
        services.AddScoped<Board.IBoardService, Board.BoardService>();
        services.AddScoped<Board.IBoardApiKeyService, Board.BoardApiKeyService>();
        return services;
    }
}
