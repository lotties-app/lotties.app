using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>Builders for planner inputs; the baby is <see cref="Prescriptions.PrescriptionFixtures.BabyId"/>, times are São Paulo (UTC-3) unless stated.</summary>
internal static class NotificationFixtures
{
    public const int SaoPauloMinutes = -180;
    public static readonly TimeSpan SaoPaulo = TimeSpan.FromMinutes(SaoPauloMinutes);
    public static readonly NotificationTimeZone SaoPauloZone = NotificationTimeZone.From("America/Sao_Paulo");
    public static readonly Guid MomId = Guid.NewGuid();
    public static readonly Guid DadId = Guid.NewGuid();
    public static readonly EventTypeKey SleepKey = BuiltInEventTypes.Sleep.Key;

    /// <summary>A São Paulo wall-clock time on 2026-03-02.</summary>
    public static DateTimeOffset At(int hour, int minute = 0, int day = 2) => new(2026, 3, day, hour, minute, 0, SaoPaulo);

    public static NotificationRecipient Recipient(
        Guid? userId = null,
        BabyRole role = BabyRole.Parent,
        bool doseDue = true,
        int doseLead = 0,
        bool napWindow = false,
        int napLead = 10,
        QuietHours? quietHours = null,
        bool quietIncludesMedicine = false,
        bool showNames = false,
        TimeSpan? offset = null,
        bool withoutZone = false,
        bool bellyPainPattern = false,
        bool overtiredWarning = false,
        bool fussyPattern = false,
        bool diaperWet = false,
        bool diaperDirty = false,
        bool appointmentReminders = true,
        NotificationTimeZone? zone = null,
        bool doctorSuggestions = false,
        bool vaccineReminders = false,
        bool cryDetected = false) =>
        new(
            userId ?? MomId,
            role,
            ReminderPreferences.Create(doseDue, doseLead, napWindow, napLead, bellyPainPattern, overtiredWarning, fussyPattern, diaperWet, diaperDirty, appointmentReminders, doctorSuggestions, vaccineReminders, cryDetected),
            quietHours ?? QuietHours.Default,
            quietIncludesMedicine,
            showNames,
            withoutZone ? null : offset ?? SaoPaulo,
            withoutZone ? null : zone ?? SaoPauloZone);

    public static NotificationBabyState State(IReadOnlyList<MedicationStatus> medications, PredictionSet? predictions = null, TimeSpan? offset = null) =>
        new(offset ?? SaoPaulo, medications, predictions);

    /// <summary>Medication statuses from the real calculator in São Paulo time.</summary>
    public static IReadOnlyList<MedicationStatus> Statuses(IReadOnlyList<Prescription> prescriptions, DateTimeOffset now, params MedicationDose[] doses) =>
        Prescriptions.PrescriptionFixtures.Calculate(prescriptions, doses, now, SaoPauloMinutes);

    public static NotificationPlan Plan(
        DateTimeOffset now,
        IReadOnlyList<NotificationRecipient> recipients,
        IReadOnlyList<NotificationBabyState> states,
        IReadOnlyList<NotificationAction>? actions = null,
        IReadOnlyCollection<DeliveredNotification>? delivered = null,
        NotificationNameSource? names = null,
        IReadOnlyList<TimeOfDayPatternState>? bellyPain = null,
        IReadOnlyList<TimeOfDayPatternState>? fussy = null,
        IReadOnlyList<WakeWindowState>? wakeWindows = null,
        DiaperPrediction? diapers = null,
        IReadOnlyCollection<SentHeadsUp>? sentHeadsUps = null,
        IReadOnlyList<Appointment>? appointments = null,
        IReadOnlyList<DoctorSuggestion>? doctorSuggestions = null,
        VaccinePlanState? vaccines = null,
        IReadOnlyList<DetectedCrySpell>? crySpells = null) =>
        NotificationPlanner.Plan(new NotificationPlanInput(
            now,
            Prescriptions.PrescriptionFixtures.BabyId,
            recipients,
            states,
            actions ?? [],
            delivered ?? [],
            names,
            BellyPainPatterns: bellyPain,
            FussyPatterns: fussy,
            WakeWindows: wakeWindows,
            Diapers: diapers,
            SentHeadsUps: sentHeadsUps,
            Appointments: appointments,
            DoctorSuggestions: doctorSuggestions,
            Vaccines: vaccines,
            CrySpells: crySpells));

    /// <summary>A belly pain pattern whose usual window runs from <paramref name="start"/> for <paramref name="widthMinutes"/> (São Paulo local times).</summary>
    public static TimeOfDayPattern BellyPattern(TimeOnly start, int widthMinutes = 60) =>
        new(start.AddMinutes(widthMinutes / 2), start, start.AddMinutes(widthMinutes), TimeSpan.FromMinutes(10), PatternConfidence.Medium, [], 6, 5);

    /// <summary>The belly pain state in São Paulo: the pattern (or none) and the latest belly pain or massage logged.</summary>
    public static TimeOfDayPatternState BellyState(TimeOfDayPattern? pattern, DateTimeOffset? lastLoggedAt = null) =>
        new(SaoPauloZone, pattern, lastLoggedAt);

    /// <summary>The fussy pattern state in São Paulo: the pattern (or none) and the latest fussy spell logged.</summary>
    public static TimeOfDayPatternState FussyState(TimeOfDayPattern? pattern, DateTimeOffset? lastLoggedAt = null) =>
        new(SaoPauloZone, pattern, lastLoggedAt);

    /// <summary>The wake window state in São Paulo: a usual limit of <paramref name="limitMinutes"/>, awake since <paramref name="awakeSince"/> (or not awake).</summary>
    public static WakeWindowState WakeState(DateTimeOffset? awakeSince, int limitMinutes = 150) =>
        new(SaoPauloZone, new WakeWindow(TimeSpan.FromMinutes(limitMinutes), [], awakeSince));

    /// <summary>An awake-window sleep prediction (baby awake, day, medium confidence unless stated).</summary>
    public static PredictionSet NapWindow(
        DateTimeOffset anchor,
        DateTimeOffset earliest,
        DateTimeOffset latest,
        PredictionConfidence confidence = PredictionConfidence.Medium,
        PredictionBasis basis = PredictionBasis.AwakeWindow,
        bool asleep = false)
    {
        var expected = earliest + ((latest - earliest) / 2);
        var reason = new PredictionReason(basis, expected - anchor, 12, TimeSpan.FromDays(14), null, DayPhase.Day, null, asleep);
        var window = new NextStartWindow(earliest.ToUniversalTime(), expected.ToUniversalTime(), latest.ToUniversalTime());
        var prediction = new Prediction(SleepKey, window, null, confidence, 12, reason, anchor.ToUniversalTime());
        return new PredictionSet([prediction], []);
    }

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>A well-formed uncompressed P-256 point (65 bytes, 0x04 prefix) as base64url.</summary>
    public static string P256dh(byte prefix = 0x04)
    {
        var bytes = Enumerable.Range(0, 65).Select(index => (byte)(index * 7)).ToArray();
        bytes[0] = prefix;
        return Base64Url(bytes);
    }

    public static string Auth(int length = 16) => Base64Url(Enumerable.Range(0, length).Select(index => (byte)(index * 13)).ToArray());

    public static PushKeys Keys() => PushKeys.Create(P256dh(), Auth());

    public static PushEndpoint FcmEndpoint(string token = "abc123") => PushEndpoint.From($"https://fcm.googleapis.com/fcm/send/{token}");
}
