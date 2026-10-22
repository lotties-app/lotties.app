using Lotties.Domain.Babies;
using Lotties.Domain.Predictions;
using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Notifications;

/// <summary>The fixed numbers of the push notification rules (docs/design/09-push-notifications.md sections 2, 3 and 5).</summary>
public static class NotificationRules
{
    /// <summary>A dose slot whose due time is pushed further than this past the slot gets no reminder.</summary>
    public static readonly TimeSpan SlotMatchWindow = MedicationStatusCalculator.SlotMatchWindow;

    /// <summary>A dose reminder whose send time is older than this is not sent (after downtime).</summary>
    public static readonly TimeSpan DoseStaleCutoff = TimeSpan.FromMinutes(30);

    /// <summary>A nap reminder whose send time is older than this is not sent.</summary>
    public static readonly TimeSpan NapStaleCutoff = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan DoseTimeToLive = TimeSpan.FromMinutes(90);

    /// <summary>A nap reminder lives until the window's latest start, at most this long.</summary>
    public static readonly TimeSpan NapMaxTimeToLive = TimeSpan.FromMinutes(60);

    public static readonly TimeSpan TestTimeToLive = TimeSpan.FromMinutes(5);

    /// <summary>The belly pain pattern heads-up is sent this long before the usual window starts.</summary>
    public static readonly TimeSpan BellyPainLead = TimeSpan.FromMinutes(30);

    /// <summary>A belly pain heads-up whose send time is older than this is not sent (it would arrive after the window opened).</summary>
    public static readonly TimeSpan BellyPainStaleCutoff = TimeSpan.FromMinutes(30);

    /// <summary>A belly pain heads-up expires this long after the usual window ends.</summary>
    public static readonly TimeSpan BellyPainExpiryAfterWindow = TimeSpan.FromMinutes(15);

    /// <summary>The fussy pattern heads-up is sent this long before the usual window starts (as belly pain).</summary>
    public static readonly TimeSpan FussyPatternLead = BellyPainLead;

    /// <summary>A fussy pattern heads-up whose send time is older than this is not sent.</summary>
    public static readonly TimeSpan FussyPatternStaleCutoff = BellyPainStaleCutoff;

    /// <summary>A fussy pattern heads-up expires this long after the usual window ends.</summary>
    public static readonly TimeSpan FussyPatternExpiryAfterWindow = BellyPainExpiryAfterWindow;

    /// <summary>The overtired heads-up is sent this long before the usual longest awake stretch ends.</summary>
    public static readonly TimeSpan OvertiredLead = WakeWindowOptions.Default.Lead;

    /// <summary>An overtired heads-up whose send time is older than this is not sent (it would arrive after the limit).</summary>
    public static readonly TimeSpan OvertiredStaleCutoff = WakeWindowOptions.Default.Lead;

    /// <summary>An overtired heads-up expires this long after the limit.</summary>
    public static readonly TimeSpan OvertiredExpiryAfterLimit = WakeWindowOptions.Default.Grace;

    /// <summary>The wet diaper heads-up is sent this long before the expected wet diaper.</summary>
    public static readonly TimeSpan DiaperWetLead = TimeSpan.FromMinutes(10);

    /// <summary>The dirty diaper heads-up from the gaps is sent this long before the expected dirty diaper (after a feed: at the lower lag).</summary>
    public static readonly TimeSpan DiaperDirtyGapLead = TimeSpan.FromMinutes(5);

    /// <summary>A diaper heads-up whose send time is older than this is not sent.</summary>
    public static readonly TimeSpan DiaperStaleCutoff = TimeSpan.FromMinutes(15);

    /// <summary>A diaper heads-up expires this long after the expected time (it is not planned from then on).</summary>
    public static readonly TimeSpan DiaperExpiryAfterExpected = TimeSpan.FromMinutes(30);

    /// <summary>At most this many diaper heads-ups of one kind per recipient, baby and local day (counting the delivered ones).</summary>
    public const int DiaperDailyCap = 3;

    /// <summary>Two diaper heads-ups (either kind) for one recipient and baby are never this close.</summary>
    public static readonly TimeSpan DiaperSpacing = TimeSpan.FromMinutes(60);

    /// <summary>An appointment reminder whose send time is older than this is not sent (after downtime).</summary>
    public static readonly TimeSpan AppointmentStaleCutoff = TimeSpan.FromMinutes(30);

    /// <summary>The longest reminder offset (1 week): appointments starting later than this from now have nothing due.</summary>
    public static readonly TimeSpan AppointmentReminderHorizon = TimeSpan.FromMinutes(Appointments.AppointmentReminders.AllowedMinutes.Max());

    /// <summary>A doctor suggestion is planned while it is newer than this; its notification expires this long after it was sent by the doctor.</summary>
    public static readonly TimeSpan DoctorSuggestionLifetime = TimeSpan.FromHours(24);

    /// <summary>The local time of day a vaccine reminder is sent (on the day the dose becomes due, and 14 days later).</summary>
    public static readonly TimeOnly VaccineReminderTime = new(9, 0);

    /// <summary>The follow-up vaccine reminder goes this long after the first one when the dose is still not recorded.</summary>
    public const int VaccineFollowUpDays = 14;

    /// <summary>At most this many reminders per scheduled dose (the first one and the follow-up).</summary>
    public const int VaccineMaxReminders = 2;

    /// <summary>A vaccine reminder whose send time is older than this is not sent (after downtime).</summary>
    public static readonly TimeSpan VaccineStaleCutoff = TimeSpan.FromHours(12);

    public static readonly TimeSpan VaccineTimeToLive = TimeSpan.FromHours(48);

    public static readonly TimeSpan SnoozeLength = TimeSpan.FromMinutes(30);

    public const int MaxSnoozes = 3;

    /// <summary>Snooze/dismiss is accepted up to this long after the delivery's due time.</summary>
    public static readonly TimeSpan ActionWindow = TimeSpan.FromHours(12);

    /// <summary>Send attempts per delivery.</summary>
    public const int MaxAttempts = 3;

    /// <summary>Consecutive failed sends after which a subscription is revoked as invalid.</summary>
    public const int MaxConsecutiveFailures = 10;

    /// <summary>Default cap of active subscriptions per user (the least recently seen is revoked beyond it).</summary>
    public const int DefaultMaxSubscriptionsPerUser = 10;

    public static readonly TimeSpan DeliveryRetention = TimeSpan.FromDays(14);

    public static readonly TimeSpan ActionRetention = TimeSpan.FromDays(7);

    public static readonly TimeSpan RevokedSubscriptionRetention = TimeSpan.FromDays(30);

    /// <summary>An active subscription not seen for this long is revoked as inactive.</summary>
    public static readonly TimeSpan InactiveSubscriptionAge = TimeSpan.FromDays(90);

    /// <summary>Only members who can log events (Owner, Parent, Caregiver) receive or opt into baby reminders; Viewers never do.</summary>
    public static bool CanReceive(BabyRole role) => role.CanLogEvents();

    /// <summary>Only the members who decide on them (Owners and Parents) receive doctor suggestions; never a Doctor, Caregiver or Viewer.</summary>
    public static bool CanReceiveDoctorSuggestions(BabyRole role) => role.CanWrite();

    /// <summary>Only Owners and Parents receive vaccine reminders; never a Caregiver, a Viewer or a Doctor.</summary>
    public static bool CanReceiveVaccineReminders(BabyRole role) => role.CanWrite();

    /// <summary>Wait before re-sending after a retryable failure (no <c>Retry-After</c>): 1 minute, then 4 minutes.</summary>
    public static TimeSpan RetryDelayAfter(int attempts) => attempts <= 1 ? TimeSpan.FromMinutes(1) : TimeSpan.FromMinutes(4);
}
