using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Measurements;
using BabyRoutine.Domain.Medications;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Domain.Predictions;
using BabyRoutine.Domain.Prescriptions;

namespace BabyRoutine.Application.Notifications.Dispatching;

/// <summary>
/// Loads what <see cref="NotificationPlanner.Plan"/> needs for one baby (design section 7, tick step 3) and runs the
/// existing pure calculators once per recipient UTC offset: prescriptions, the doses of
/// <see cref="MedicationStatusCalculator.HistoryLookBack"/> and the latest weight (as the medication status endpoint)
/// only when a recipient wants dose reminders; the prediction history (as the predictions endpoint) only when one wants
/// nap reminders; names only when one has show-names on.
/// </summary>
internal sealed class NotificationPlanInputLoader(
    IPrescriptionRepository prescriptions,
    IMedicationDoseHistoryRepository doses,
    IMeasurementRepository measurements,
    IPredictionHistoryRepository predictionHistory,
    IBabyRepository babies,
    IMedicationRepository medications,
    INotificationActionRepository actions,
    PredictionOptions predictionOptions)
{
    public async Task<NotificationPlanInput> LoadAsync(
        Guid babyId,
        IReadOnlyList<NotificationRecipient> recipients,
        IReadOnlyCollection<DeliveredNotification> delivered,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var plannable = recipients.Where(recipient => NotificationRules.CanReceive(recipient.Role) && recipient.UtcOffset is not null).ToArray();
        if (plannable.Length == 0)
        {
            return new NotificationPlanInput(now, babyId, recipients, [], [], delivered, null, predictionOptions);
        }

        var medication = plannable.Any(recipient => recipient.Preferences.DoseDue) ? await LoadMedicationAsync(babyId, now, cancellationToken) : null;
        var history = plannable.Any(recipient => recipient.Preferences.NapWindow) ? await predictionHistory.LoadAsync(babyId, now - predictionOptions.LookBack, cancellationToken) : null;
        var states = plannable.Select(recipient => recipient.UtcOffset!.Value).Distinct().Select(offset => StateAt(offset, medication, history, now)).ToArray();
        var userActions = await actions.ListForBabyAsync(babyId, recipients.Select(recipient => recipient.UserId).ToArray(), cancellationToken);
        var names = plannable.Any(recipient => recipient.ShowNames) ? await LoadNamesAsync(babyId, cancellationToken) : null;
        return new NotificationPlanInput(now, babyId, recipients, states, userActions, delivered, names, predictionOptions);
    }

    private async Task<MedicationData> LoadMedicationAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var active = await prescriptions.ListActiveAsync(babyId, cancellationToken);
        var given = await doses.ListDosesAsync(babyId, now - MedicationStatusCalculator.HistoryLookBack, cancellationToken);
        var latest = await measurements.FindLatestWithWeightAsync(babyId, cancellationToken);
        return new MedicationData(active, given, latest?.WeightKg is { } kg ? new BodyWeight(kg, latest.Date) : null);
    }

    private NotificationBabyState StateAt(TimeSpan utcOffset, MedicationData? medication, PredictionHistory? history, DateTimeOffset now)
    {
        IReadOnlyList<MedicationStatus> statuses = medication is null
            ? []
            : MedicationStatusCalculator.Calculate(new MedicationStatusInput(medication.Prescriptions, medication.Doses, now, utcOffset, medication.Weight));
        var predictions = history is null
            ? null
            : PredictionEngine.Predict(history.Events, new PredictionContext(history.BirthDate, now.ToOffset(utcOffset)), predictionOptions);
        return new NotificationBabyState(utcOffset, statuses, predictions);
    }

    private async Task<NotificationNameSource> LoadNamesAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var baby = await babies.FindAsync(babyId, cancellationToken);
        var babyMedications = await medications.ListForBabyAsync(babyId, cancellationToken);
        return new NotificationNameSource(baby?.Name ?? string.Empty, babyMedications.ToDictionary(item => item.Id, item => item.Name));
    }

    private sealed record MedicationData(IReadOnlyList<Prescription> Prescriptions, IReadOnlyList<MedicationDose> Doses, BodyWeight? Weight);
}
