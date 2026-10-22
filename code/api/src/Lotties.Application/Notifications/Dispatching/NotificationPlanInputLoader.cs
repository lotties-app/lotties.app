using Lotties.Application.Vaccinations;
using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notifications;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// Loads what <see cref="NotificationPlanner.Plan"/> needs for one baby (design section 7, tick step 3) and runs the
/// existing pure calculators once per recipient UTC offset: prescriptions, the doses of
/// <see cref="MedicationStatusCalculator.HistoryLookBack"/> and the latest weight (as the medication status endpoint)
/// only when a recipient wants dose reminders; the prediction history (as the predictions endpoint) only when one wants
/// nap reminders or a heads-up read from the events (belly pain, fussy, overtired: each is read once per time zone of
/// the recipients who want it, daylight saving applied per event; the diaper predictions once, elapsed time needs no
/// zone); the upcoming appointments within a week only when one wants appointment reminders; the doctor suggestions of
/// the last 24 hours only when an Owner or Parent wants them; the vaccine schedule, the baby's vaccine profile and its
/// records that are not deleted only when an Owner or Parent wants vaccine reminders; names only when one has show-names on.
/// </summary>
internal sealed class NotificationPlanInputLoader(
    IAppointmentRepository appointments,
    IDoctorSuggestionRepository doctorSuggestions,
    IPrescriptionRepository prescriptions,
    IMedicationDoseHistoryRepository doses,
    IMeasurementRepository measurements,
    IPredictionHistoryRepository predictionHistory,
    IBabyRepository babies,
    IMedicationRepository medications,
    INotificationActionRepository actions,
    IVaccinationRepository vaccinations,
    IVaccineScheduleProvider vaccineSchedule,
    PredictionOptions predictionOptions)
{
    public async Task<NotificationPlanInput> LoadAsync(
        Guid babyId,
        IReadOnlyList<NotificationRecipient> recipients,
        ClaimHistory claims,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(claims);
        var plannable = recipients.Where(recipient => NotificationRules.CanReceive(recipient.Role) && recipient.UtcOffset is not null).ToArray();
        if (plannable.Length == 0)
        {
            return new NotificationPlanInput(now, babyId, recipients, [], [], claims.Delivered, null, predictionOptions);
        }

        var medication = plannable.Any(recipient => recipient.Preferences.DoseDue) ? await LoadMedicationAsync(babyId, now, cancellationToken) : null;
        var wantsNap = plannable.Any(recipient => recipient.Preferences.NapWindow);
        var history = plannable.Any(recipient => recipient.Preferences.WantsEventHistory) ? await predictionHistory.LoadAsync(babyId, now - predictionOptions.LookBack, cancellationToken) : null;
        var states = plannable.Select(recipient => recipient.UtcOffset!.Value).Distinct().Select(offset => StateAt(offset, medication, wantsNap ? history : null, now)).ToArray();
        var userActions = await actions.ListForBabyAsync(babyId, recipients.Select(recipient => recipient.UserId).ToArray(), cancellationToken);
        var names = plannable.Any(recipient => recipient.ShowNames) ? await LoadNamesAsync(babyId, cancellationToken) : null;
        var upcoming = plannable.Any(recipient => recipient.Preferences.AppointmentReminders)
            ? await appointments.ListUpcomingAsync(babyId, now, now + NotificationRules.AppointmentReminderHorizon, cancellationToken)
            : [];
        var suggestions = plannable.Any(WantsDoctorSuggestions)
            ? await doctorSuggestions.ListSinceAsync(babyId, now - NotificationRules.DoctorSuggestionLifetime, cancellationToken)
            : [];
        var vaccines = plannable.Any(WantsVaccineReminders) ? await LoadVaccinesAsync(babyId, cancellationToken) : null;
        return new NotificationPlanInput(
            now,
            babyId,
            recipients,
            states,
            userActions,
            claims.Delivered,
            names,
            predictionOptions,
            history is null ? [] : BellyPainStates(plannable, history, now),
            history is null ? [] : FussyStates(plannable, history, now),
            history is null ? [] : WakeWindowStates(plannable, history, now),
            DiapersOf(plannable, history, now),
            claims.SentHeadsUps,
            upcoming,
            suggestions,
            vaccines);
    }

    private static bool WantsVaccineReminders(NotificationRecipient recipient) =>
        recipient.Preferences.VaccineReminders && NotificationRules.CanReceiveVaccineReminders(recipient.Role);

    /// <summary>The schedule, the baby's vaccine profile and birth date, and its records that are not deleted; <c>null</c> without the baby.</summary>
    private async Task<VaccinePlanState?> LoadVaccinesAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var baby = await babies.FindAsync(babyId, cancellationToken);
        if (baby is null)
        {
            return null;
        }

        var records = await vaccinations.ListActiveAsync(babyId, cancellationToken);
        return new VaccinePlanState(vaccineSchedule.Schedule, baby.VaccineProfile, baby.BirthDate, records.Select(record => record.ToRecord()).ToArray());
    }

    private static bool WantsDoctorSuggestions(NotificationRecipient recipient) =>
        recipient.Preferences.DoctorSuggestions && NotificationRules.CanReceiveDoctorSuggestions(recipient.Role);

    /// <summary>The diaper predictions when a recipient wants a diaper heads-up.</summary>
    private static DiaperPrediction? DiapersOf(IEnumerable<NotificationRecipient> recipients, PredictionHistory? history, DateTimeOffset now) =>
        history is not null && recipients.Any(recipient => recipient.Preferences.WantsDiapers)
            ? DiaperPredictions.Predict(history.Events, now)
            : null;

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

    /// <summary>The distinct time zones of the recipients who want a kind (a recipient without a zone gets no heads-up).</summary>
    private static IEnumerable<NotificationTimeZone> ZonesWanting(IEnumerable<NotificationRecipient> recipients, Func<ReminderPreferences, bool> wants) =>
        recipients
            .Where(recipient => wants(recipient.Preferences) && recipient.TimeZone is not null)
            .Select(recipient => recipient.TimeZone!.Value)
            .DistinctBy(zone => zone.Value);

    /// <summary>The belly pain pattern in each time zone of the recipients who want the heads-up.</summary>
    private static IReadOnlyList<TimeOfDayPatternState> BellyPainStates(IEnumerable<NotificationRecipient> recipients, PredictionHistory history, DateTimeOffset now)
    {
        var lastLoggedAt = BellyPainPatterns.LastLoggedAt(history.Events, now);
        return ZonesWanting(recipients, preferences => preferences.BellyPainPattern)
            .Select(zone => new TimeOfDayPatternState(zone, BellyPainPatterns.Detect(history.Events, now, zone.Clock()), lastLoggedAt))
            .ToArray();
    }

    /// <summary>The fussy pattern in each time zone of the recipients who want the heads-up.</summary>
    private static IReadOnlyList<TimeOfDayPatternState> FussyStates(IEnumerable<NotificationRecipient> recipients, PredictionHistory history, DateTimeOffset now)
    {
        var lastLoggedAt = FussyPatterns.LastLoggedAt(history.Events, now);
        return ZonesWanting(recipients, preferences => preferences.FussyPattern)
            .Select(zone => new TimeOfDayPatternState(zone, FussyPatterns.Detect(history.Events, now, zone.Clock()), lastLoggedAt))
            .ToArray();
    }

    /// <summary>The wake window in each time zone of the recipients who want the overtired heads-up.</summary>
    private IReadOnlyList<WakeWindowState> WakeWindowStates(IEnumerable<NotificationRecipient> recipients, PredictionHistory history, DateTimeOffset now) =>
        ZonesWanting(recipients, preferences => preferences.OvertiredWarning)
            .Select(zone => new WakeWindowState(zone, WakeWindows.Measure(history.Events, now, zone.Clock(), WakeWindowOptions.Default, predictionOptions)))
            .ToArray();

    private async Task<NotificationNameSource> LoadNamesAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var baby = await babies.FindAsync(babyId, cancellationToken);
        var babyMedications = await medications.ListForBabyAsync(babyId, cancellationToken);
        return new NotificationNameSource(baby?.Name ?? string.Empty, babyMedications.ToDictionary(item => item.Id, item => item.Name));
    }

    private sealed record MedicationData(IReadOnlyList<Prescription> Prescriptions, IReadOnlyList<MedicationDose> Doses, BodyWeight? Weight);
}

/// <summary>What was already claimed for the candidates: the dedupe keys (any status) and the capped heads-ups that count.</summary>
internal sealed record ClaimHistory(IReadOnlyCollection<DeliveredNotification> Delivered, IReadOnlyCollection<SentHeadsUp> SentHeadsUps);
